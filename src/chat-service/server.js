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
  // Handle empty or whitespace-only text
  if (!text || text.trim().length === 0) {
    return {
      orders: [],
      message: "I'm sorry, I couldn't generate a response. Please try again."
    };
  }

  // New format: plain text message followed by "<<<ORDERS>>> [json]"
  const ordersMarker = '<<<ORDERS>>>';
  const ordersIndex = text.indexOf(ordersMarker);
  
  if (ordersIndex !== -1) {
    // Extract message (everything before ORDERS:)
    const message = text.substring(0, ordersIndex).trim();
    
    // Extract orders JSON (everything after ORDERS:)
    const ordersText = text.substring(ordersIndex + ordersMarker.length).trim();
    
    let orders = [];
    try {
      if (ordersText && ordersText !== '[]') {
        orders = JSON.parse(ordersText);
      }
    } catch (e) {
      console.error('Error parsing orders JSON:', e);
      // Continue with empty orders array
    }
    
    return {
      orders: orders,
      message: message || "How can I help you?"
    };
  }

  // Fallback: Try old JSON format for backward compatibility
  try {
    const parsed = JSON.parse(text);
    const message = parsed.response || parsed.message || '';
    
    if (!message || message.trim().length === 0) {
      return {
        orders: parsed.orders || [],
        message: "I received your message. How can I help you?"
      };
    }

    return {
      orders: parsed.orders || [],
      message: message
    };
  } catch (e) {
    // Not JSON, treat entire text as message
    return {
      orders: [],
      message: text.trim()
    };
  }
}

// Chat service implementation
const chatService = {
  processChat: async (call, callback) => {
    try {
      const { text, history } = call.request;

      // Format prompt and generate response
      const prompt = formatPrompt(text, history || []);

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
      const { message, orders } = parseOrders(llmResponse);

      callback(null, { response: message, orders });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        details: `Error processing chat: ${error.message}`
      });
    }
  },

  streamChat: async (call) => {
    let streamEnded = false;

    try {
      const { text, history } = call.request;
      const prompt = formatPrompt(text, history || []);

      if (process.env.NODE_ENV === 'development') {
        console.log("=============== START PROMPT ===============")
        console.log(prompt)
        console.log("=============== END PROMPT ===============")
      }

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

      // Handle call cancellation
      call.on('cancelled', () => {
        console.log('Client cancelled the stream');
        streamEnded = true;
        reader.destroy();
      });

      reader.on('data', (chunk) => {
        if (streamEnded || call.cancelled) return;

        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (streamEnded || call.cancelled) break;

          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            if (data === '[DONE]') {
              // Parse final response for orders
              const { message, orders } = parseOrders(fullResponse);

              if (!streamEnded && !call.cancelled) {
                try {
                  call.write({
                    content: '',
                    is_final: true,
                    final_message: message,
                    orders: orders
                  });
                  call.end();
                  streamEnded = true;
                } catch (e) {
                  console.error('Error writing final message:', e);
                }
              }
              return;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.content && !streamEnded && !call.cancelled) {
                fullResponse += parsed.content;
                try {
                  call.write({
                    content: parsed.content,
                    is_final: false,
                    orders: []
                  });
                } catch (e) {
                  console.error('Error writing chunk:', e);
                  streamEnded = true;
                  reader.destroy();
                }
              }

              // Check if generation is complete
              if (parsed.stop && !streamEnded && !call.cancelled) {
                const { message, orders } = parseOrders(fullResponse);

                try {
                  call.write({
                    content: '',
                    is_final: true,
                    final_message: message,
                    orders: orders
                  });
                  call.end();
                  streamEnded = true;
                } catch (e) {
                  console.error('Error writing final message:', e);
                }
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      });

      reader.on('end', () => {
        if (process.env.NODE_ENV === 'development') {
          console.log("=============== START FULL RESPONSE =============");
          console.log(fullResponse);
          console.log("=============== END FULL RESPONSE ===============");
        }

        if (!streamEnded && !call.cancelled) {
          const { message, orders } = parseOrders(fullResponse);

          try {
            call.write({
              content: '',
              is_final: true,
              final_message: message,
              orders: orders
            });
            call.end();
            streamEnded = true;
          } catch (e) {
            console.error('Error writing final message on end:', e);
          }
        }
      });

      reader.on('error', (error) => {
        console.error('Stream error:', error);
        if (!streamEnded && !call.cancelled) {
          try {
            call.destroy(error);
          } catch (e) {
            console.error('Error destroying call:', e);
          }
          streamEnded = true;
        }
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