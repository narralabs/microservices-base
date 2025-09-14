const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const fetch = require('node-fetch');
const { formatPrompt } = require('./prompt_template');

// Load protobuf
const PROTO_PATH = path.join(__dirname, './proto/chat.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const chatProto = protoDescriptor.chat;

// Llama service configuration
const LLAMA_SERVICE_URL = process.env.LLAMA_SERVICE_URL || 'http://llama-service:8080';

// Parse LLM response to extract orders
function parseOrders(text) {
  try {
    const response = JSON.parse(text);
    return {
      orders: response.orders || [],
      response: response.response || text
    };
  } catch (e) {
    return {
      orders: [],
      response: text
    };
  }
}

// Chat service implementation
const chatService = {
  processChat: async (call, callback) => {
    try {
      const { text } = call.request;

      // Format prompt and generate response
      const prompt = formatPrompt(text);

      // Call llama service
      const response = await fetch(`${LLAMA_SERVICE_URL}/completion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          n_predict: 512,
          temperature: 0.7,
          stop: ['</s>', 'User:', 'Assistant:']
        })
      });

      if (!response.ok) {
        throw new Error(`Llama service error: ${response.status} ${response.statusText}`);
      }

      const llamaResponse = await response.json();
      const llmResponse = llamaResponse.content;

      console.log('====> ', llmResponse);

      // Parse response and extract orders
      const { response: parsedResponse, orders } = parseOrders(llmResponse);

      callback(null, { response: parsedResponse, orders });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        details: `Error processing chat: ${error.message}`
      });
    }
  }
};

// Create and start gRPC server
function startServer() {
  const server = new grpc.Server();
  server.addService(chatProto.ChatService.service, chatService);

  server.bindAsync(
    '0.0.0.0:50051',
    grpc.ServerCredentials.createInsecure(),
    (error, port) => {
      if (error) {
        console.error('Failed to bind server:', error);
        return;
      }
      server.start();
      console.log(`Chat service running on port ${port}`);
    }
  );
}

startServer();