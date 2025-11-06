const express = require('express');
const http = require('http');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require('stream');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 8001;
const SPEACHES_SERVICE_URL = process.env.SPEACHES_SERVICE_URL || 'http://speaches-service:8000';

// Configure multer for in-memory file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Speech-to-Text endpoint
app.post('/api/stt', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log('Received audio file:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    // Create form data for speaches-service
    const formData = new FormData();

    // Create a readable stream from the buffer
    const audioStream = Readable.from(req.file.buffer);

    // Append the audio file to form data (Speaches expects 'file', not 'audio_file')
    formData.append('file', audioStream, {
      filename: req.file.originalname || 'audio.webm',
      contentType: req.file.mimetype || 'audio/webm'
    });

    // Add required model parameter (use the available model in Speaches)
    formData.append('model', 'Systran/faster-distil-whisper-small.en');
    // Disable VAD to prevent filtering out audio
    formData.append('vad_filter', 'false');

    // Forward to speaches-service STT endpoint
    const response = await axios.post(
      `${SPEACHES_SERVICE_URL}/v1/audio/transcriptions`,
      formData,
      {
        headers: {
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 60000 // 60 second timeout
      }
    );

    console.log('STT response:', response.data);

    // Return the transcribed text
    res.json({
      text: response.data.text || response.data.transcription || '',
      language: response.data.language || 'en'
    });

  } catch (error) {
    console.error('Error processing STT:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to transcribe audio',
      details: error.response?.data || error.message
    });
  }
});

// Text-to-Speech endpoint
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice, speed } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log('TTS request:', { text, voice, speed });

    // Forward to speaches-service TTS endpoint
    const response = await axios.post(
      `${SPEACHES_SERVICE_URL}/v1/audio/speech`,
      {
        model: 'speaches-ai/Kokoro-82M-v1.0-ONNX-fp16',
        input: text,
        voice: voice || 'af_sky', // Default voice
        speed: speed || 4 // Default to 2x speed (faster)
      },
      {
        responseType: 'arraybuffer',
        timeout: 60000 // 60 second timeout
      }
    );

    // Set appropriate headers for audio response
    res.set('Content-Type', 'audio/wav');
    res.set('Content-Length', response.data.length);
    res.send(Buffer.from(response.data));

  } catch (error) {
    console.error('Error processing TTS:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to synthesize speech',
      details: error.response?.data || error.message
    });
  }
});

// Combined STT + Chat + TTS endpoint for complete voice interaction
app.post('/api/voice-order', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Step 1: Transcribe audio
    const formData = new FormData();
    const audioStream = Readable.from(req.file.buffer);
    formData.append('file', audioStream, {
      filename: req.file.originalname || 'audio.webm',
      contentType: req.file.mimetype || 'audio/webm'
    });
    formData.append('model', 'Systran/faster-distil-whisper-small.en');
    // Disable VAD to prevent filtering out audio
    formData.append('vad_filter', 'false');

    const sttResponse = await axios.post(
      `${SPEACHES_SERVICE_URL}/v1/audio/transcriptions`,
      formData,
      {
        headers: {
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 60000
      }
    );

    const transcribedText = sttResponse.data.text || sttResponse.data.transcription || '';
    console.log('Transcribed text:', transcribedText);

    // Return both the transcription and indicate that chat processing should follow
    res.json({
      text: transcribedText,
      language: sttResponse.data.language || 'en'
    });

  } catch (error) {
    console.error('Error processing voice order:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to process voice order',
      details: error.response?.data || error.message
    });
  }
});

// Socket.IO realtime audio handling
io.on('connection', (socket) => {
  console.log('Client connected for realtime audio:', socket.id);

  let isProcessing = false;

  // Handle complete audio blob from client
  socket.on('audio-complete', async (data) => {
    if (isProcessing) {
      console.log('Already processing, ignoring new audio');
      return;
    }

    isProcessing = true;

    try {
      const { audio, mimeType } = data;
      const audioBuffer = Buffer.from(audio);

      console.log('Received complete audio:', audioBuffer.length, 'bytes, mimeType:', mimeType);

      // Debug: Save audio to file to inspect
      const fs = require('fs');
      const debugPath = `/tmp/debug_audio_${Date.now()}.webm`;
      fs.writeFileSync(debugPath, audioBuffer);
      console.log('Saved debug audio to:', debugPath);

      if (audioBuffer.length === 0) {
        socket.emit('error', { message: 'No audio data received' });
        isProcessing = false;
        return;
      }

      // Send to speaches service for transcription
      socket.emit('status', { message: 'Transcribing audio...' });

      const formData = new FormData();
      const audioStream = Readable.from(audioBuffer);

      // Determine filename based on mimeType
      let filename = 'audio.webm';
      let contentType = mimeType || 'audio/webm';

      if (mimeType && mimeType.includes('ogg')) {
        filename = 'audio.ogg';
      } else if (mimeType && mimeType.includes('webm')) {
        filename = 'audio.webm';
      }

      formData.append('file', audioStream, {
        filename: filename,
        contentType: contentType
      });
      formData.append('model', 'Systran/faster-distil-whisper-small.en');
      // Disable VAD or use less aggressive settings
      formData.append('vad_filter', 'false');
      // Add language hint
      formData.append('language', 'en');

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
      console.log('STT Response:', JSON.stringify(sttResponse.data));
      console.log('Transcribed text:', transcribedText);

      if (!transcribedText || transcribedText.trim() === '') {
        socket.emit('transcription-complete', { 
          text: '',
          error: 'Could not understand audio. Please try again.'
        });
        isProcessing = false;
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
      console.log('TTS generation complete, sending audio to client');
      socket.emit('tts-complete', {
        audio: Buffer.from(ttsResponse.data).toString('base64'),
        mimeType: 'audio/wav'
      });
      console.log('TTS audio sent to client');

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
    isProcessing = false;
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error('Socket error:', error);
    isProcessing = false;
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Audio service listening on port ${PORT}`);
  console.log(`Speaches service URL: ${SPEACHES_SERVICE_URL}`);
  console.log('Socket.IO realtime audio handler initialized');
});

