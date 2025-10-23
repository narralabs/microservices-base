const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require('stream');

const SPEACHES_SERVICE_URL = process.env.SPEACHES_SERVICE_URL || 'http://speaches-service:8000';

module.exports = function(io) {
  io.on('connection', (socket) => {
    console.log('Client connected for realtime audio:', socket.id);
    
    let audioChunks = [];
    let isProcessing = false;

    // Handle audio stream from client
    socket.on('audio-stream', async (data) => {
      try {
        // Don't accept new chunks if we're currently processing
        if (isProcessing) {
          console.log('Still processing previous audio, ignoring chunk');
          return;
        }
        
        console.log('Received audio chunk:', data.length, 'bytes');
        
        // Accumulate audio chunks
        audioChunks.push(Buffer.from(data));
        
        // Send acknowledgment
        socket.emit('audio-received', { 
          size: data.length,
          totalChunks: audioChunks.length 
        });
        
      } catch (error) {
        console.error('Error handling audio stream:', error);
        socket.emit('error', { message: 'Failed to process audio stream' });
      }
    });

    // Handle end of recording - process complete audio
    socket.on('audio-end', async () => {
      if (isProcessing) {
        console.log('Already processing, ignoring duplicate audio-end');
        return;
      }

      isProcessing = true;
      
      try {
        console.log('Processing complete audio with', audioChunks.length, 'chunks');
        
        if (audioChunks.length === 0) {
          socket.emit('error', { message: 'No audio data received' });
          setTimeout(() => {
            isProcessing = false;
          }, 100);
          return;
        }

        // Combine all chunks into single buffer
        const audioBuffer = Buffer.concat(audioChunks);
        console.log('Total audio size:', audioBuffer.length, 'bytes');
        
        // Clear chunks
        audioChunks = [];

        // Send to speaches service for transcription
        socket.emit('status', { message: 'Transcribing audio...' });
        
        const formData = new FormData();
        const audioStream = Readable.from(audioBuffer);
        
        formData.append('file', audioStream, {
          filename: 'audio.webm',
          contentType: 'audio/webm'
        });
        formData.append('model', 'Systran/faster-distil-whisper-small.en');

        const sttResponse = await axios.post(
          `${SPEACHES_SERVICE_URL}/v1/audio/transcriptions`,
          formData,
          {
            headers: formData.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 60000
          }
        );

        const transcribedText = sttResponse.data.text || sttResponse.data.transcription || '';
        console.log('Transcribed text:', transcribedText);

        if (!transcribedText || transcribedText.trim() === '') {
          socket.emit('transcription-complete', { 
            text: '',
            error: 'Could not understand audio. Please try again.'
          });
          setTimeout(() => {
            isProcessing = false;
          }, 100);
          return;
        }

        // Send transcription result
        socket.emit('transcription-complete', {
          text: transcribedText,
          language: sttResponse.data.language || 'en'
        });

        // Reset processing flag AFTER a short delay to ensure client processes the response
        setTimeout(() => {
          isProcessing = false;
        }, 100);

      } catch (error) {
        console.error('Error processing audio:', error.response?.data || error.message);
        socket.emit('error', { 
          message: 'Failed to transcribe audio',
          details: error.response?.data || error.message
        });
        audioChunks = [];
        isProcessing = false;
      }
    });

    // Handle TTS request
    socket.on('tts-request', async (data) => {
      try {
        const { text, voice } = data;
        
        if (!text) {
          socket.emit('error', { message: 'Text is required for TTS' });
          return;
        }

        console.log('TTS request:', { text, voice });
        socket.emit('status', { message: 'Generating speech...' });

        // Call speaches service for TTS
        const ttsResponse = await axios.post(
          `${SPEACHES_SERVICE_URL}/v1/audio/speech`,
          {
            model: 'speaches-ai/Kokoro-82M-v1.0-ONNX-fp16',
            input: text,
            voice: voice || 'af_sky'
          },
          {
            responseType: 'arraybuffer',
            timeout: 60000
          }
        );

        // Send audio data back to client
        socket.emit('tts-complete', {
          audio: Buffer.from(ttsResponse.data).toString('base64'),
          mimeType: 'audio/wav'
        });

      } catch (error) {
        console.error('Error processing TTS:', error.response?.data || error.message);
        socket.emit('error', { 
          message: 'Failed to synthesize speech',
          details: error.response?.data || error.message
        });
      }
    });

    // Handle client disconnect
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      audioChunks = [];
      isProcessing = false;
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
      audioChunks = [];
      isProcessing = false;
    });
  });

  console.log('Realtime audio handler initialized');
};

