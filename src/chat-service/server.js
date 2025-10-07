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
  },

  streamChat: async (call) => {
    try {
      const { text } = call.request;
      const prompt = formatPrompt(text);

      // Call llama service with streaming enabled
      const response = await fetch(`${LLAMA_SERVICE_URL}/completion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          n_predict: 512,
          temperature: 0.7,
          stop: ['</s>', 'User:', 'Assistant:'],
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`Llama service error: ${response.status} ${response.statusText}`);
      }

      let fullResponse = '';

      // Process the SSE stream from llama.cpp
      const reader = response.body;
      let buffer = '';

      reader.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            if (data === '[DONE]') {
              // Parse final response for orders
              const { response: parsedResponse, orders } = parseOrders(fullResponse);
              call.write({
                content: '',
                is_final: true,
                orders: orders
              });
              call.end();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullResponse += parsed.content;
                call.write({
                  content: parsed.content,
                  is_final: false,
                  orders: []
                });
              }

              // Check if generation is complete
              if (parsed.stop) {
                const { response: parsedResponse, orders } = parseOrders(fullResponse);
                call.write({
                  content: '',
                  is_final: true,
                  orders: orders
                });
                call.end();
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      });

      reader.on('end', () => {
        if (!call.finished) {
          const { response: parsedResponse, orders } = parseOrders(fullResponse);
          call.write({
            content: '',
            is_final: true,
            orders: orders
          });
          call.end();
        }
      });

      reader.on('error', (error) => {
        console.error('Stream error:', error);
        call.destroy(error);
      });

    } catch (error) {
      call.destroy({
        code: grpc.status.INTERNAL,
        details: `Error processing chat stream: ${error.message}`
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