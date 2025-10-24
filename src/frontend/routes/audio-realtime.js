const socketIOClient = require('socket.io-client');

const AUDIO_SERVICE_URL = process.env.AUDIO_SERVICE_URL || 'http://audio-service-k8s-service:8001';

module.exports = function(io) {
  io.on('connection', (socket) => {
    console.log('Client connected for realtime audio:', socket.id);

    // Create a connection to audio-service
    const audioServiceSocket = socketIOClient(AUDIO_SERVICE_URL, {
      transports: ['websocket', 'polling']
    });

    // Forward audio stream to audio-service
    socket.on('audio-stream', (data) => {
      audioServiceSocket.emit('audio-stream', data);
    });

    // Forward audio-end to audio-service
    socket.on('audio-end', () => {
      audioServiceSocket.emit('audio-end');
    });

    // Forward TTS request to audio-service
    socket.on('tts-request', (data) => {
      audioServiceSocket.emit('tts-request', data);
    });

    // Forward responses from audio-service back to client
    audioServiceSocket.on('audio-received', (data) => {
      socket.emit('audio-received', data);
    });

    audioServiceSocket.on('status', (data) => {
      socket.emit('status', data);
    });

    audioServiceSocket.on('transcription-complete', (data) => {
      socket.emit('transcription-complete', data);
    });

    audioServiceSocket.on('tts-complete', (data) => {
      socket.emit('tts-complete', data);
    });

    audioServiceSocket.on('error', (data) => {
      socket.emit('error', data);
    });

    // Handle client disconnect
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      audioServiceSocket.disconnect();
    });

    // Handle audio-service connection errors
    audioServiceSocket.on('connect_error', (error) => {
      console.error('Audio service connection error:', error);
      socket.emit('error', { message: 'Failed to connect to audio service' });
    });
  });

  console.log('Realtime audio proxy handler initialized');
  console.log(`Audio service URL: ${AUDIO_SERVICE_URL}`);
};

