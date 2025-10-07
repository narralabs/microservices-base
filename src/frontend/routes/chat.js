const express = require('express');
const router = express.Router();
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

// Load chat service proto
const PROTO_PATH = path.join(__dirname, '../proto/chat.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const chatProto = protoDescriptor.chat;

// Create gRPC client
const client = new chatProto.ChatService(
  process.env.CHAT_SERVICE_URL,
  grpc.credentials.createInsecure()
);

// Handle chat requests
router.post('/', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  client.processChat({ text }, (error, response) => {
    if (error) {
      console.error('Error processing chat:', error);
      return res.status(500).json({ error: 'Failed to process chat message' });
    }

    res.json({
      response: response.response,
      orders: response.orders
    });
  });
});

// Handle streaming chat requests
router.get('/stream', (req, res) => {
  const { text } = req.query;

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Call gRPC streaming endpoint
  const stream = client.streamChat({ text });

  stream.on('data', (chunk) => {
    // Send SSE data to client
    res.write(`data: ${JSON.stringify({
      content: chunk.content,
      is_final: chunk.is_final,
      orders: chunk.orders
    })}\n\n`);

    // Close connection on final message
    if (chunk.is_final) {
      res.end();
    }
  });

  stream.on('error', (error) => {
    console.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Stream error occurred' })}\n\n`);
    res.end();
  });

  stream.on('end', () => {
    res.end();
  });

  // Clean up on client disconnect
  req.on('close', () => {
    stream.cancel();
  });
});

module.exports = router;
