const express = require('express');
const router = express.Router();
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

// Load chat service proto
const PROTO_PATH = path.join(__dirname, '../protos/chat.proto');
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
router.post('/stream', (req, res) => {
  const { text, history } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable buffering for nginx
  });

  // Send initial comment to establish the connection
  res.write(':ok\n\n');

  let streamEnded = false;

  // Call gRPC streaming endpoint
  const stream = client.streamChat({ text, history: history || [] });

  stream.on('data', (chunk) => {
    if (streamEnded) return;

    try {
      // Send SSE data to client
      res.write(`data: ${JSON.stringify({
        content: chunk.content,
        is_final: chunk.is_final,
        orders: chunk.orders,
        final_message: chunk.final_message
      })}\n\n`);

      // Close connection on final message
      if (chunk.is_final) {
        streamEnded = true;
        res.end();
      }
    } catch (error) {
      console.error('Error writing to stream:', error);
      streamEnded = true;
    }
  });

  stream.on('error', (error) => {
    console.error('Stream error:', error);
    if (!streamEnded && !res.writableEnded) {
      try {
        // Extract meaningful error message from gRPC error
        let errorMessage = 'Stream error occurred';
        if (error.details) {
          errorMessage = error.details;
        } else if (error.message) {
          errorMessage = error.message;
        }

        res.write(`data: ${JSON.stringify({
          error: errorMessage,
          is_final: true
        })}\n\n`);
        res.end();
      } catch (e) {
        console.error('Error ending stream:', e);
      }
      streamEnded = true;
    }
  });

  stream.on('end', () => {
    if (!streamEnded && !res.writableEnded) {
      res.end();
      streamEnded = true;
    }
  });

  // Clean up on client disconnect (listen to response close, not request close)
  res.on('close', () => {
    if (!streamEnded) {
      stream.cancel();
      streamEnded = true;
    }
  });
});

module.exports = router;
