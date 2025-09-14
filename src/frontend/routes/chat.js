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

module.exports = router;
