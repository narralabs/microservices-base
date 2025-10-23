const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require('stream');

const app = express();
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
        speed: speed || 2 // Default to 2x speed (faster)
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
    formData.append('model', 'whisper-1');

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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Audio service listening on port ${PORT}`);
  console.log(`Speaches service URL: ${SPEACHES_SERVICE_URL}`);
});

