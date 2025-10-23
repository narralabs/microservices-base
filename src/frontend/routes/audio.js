const express = require('express');
const router = express.Router();
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const { Readable } = require('stream');

// Configure multer for in-memory file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const AUDIO_SERVICE_URL = process.env.AUDIO_SERVICE_URL || 'http://audio-service:8001';

// Speech-to-Text endpoint
router.post('/stt', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log('Forwarding audio to audio-service:', {
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    // Create form data
    const formData = new FormData();
    const audioStream = Readable.from(req.file.buffer);

    formData.append('audio', audioStream, {
      filename: req.file.originalname || 'audio.webm',
      contentType: req.file.mimetype || 'audio/webm'
    });

    // Forward to audio-service
    const response = await axios.post(
      `${AUDIO_SERVICE_URL}/api/stt`,
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

    res.json(response.data);

  } catch (error) {
    console.error('Error in STT endpoint:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to transcribe audio',
      details: error.response?.data || error.message
    });
  }
});

// Text-to-Speech endpoint
router.post('/tts', async (req, res) => {
  try {
    const { text, voice } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log('Forwarding TTS request to audio-service');

    // Forward to audio-service
    const response = await axios.post(
      `${AUDIO_SERVICE_URL}/api/tts`,
      {
        text: text,
        voice: voice || 'af_sky'
      },
      {
        responseType: 'arraybuffer',
        timeout: 60000
      }
    );

    // Set appropriate headers for audio response
    res.set('Content-Type', 'audio/wav');
    res.set('Content-Length', response.data.length);
    res.send(Buffer.from(response.data));

  } catch (error) {
    console.error('Error in TTS endpoint:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to synthesize speech',
      details: error.response?.data || error.message
    });
  }
});

module.exports = router;

