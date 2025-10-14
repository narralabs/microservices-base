const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const fetch = require('node-fetch');
const { formatPrompt } = require('./prompt_template');

// Load protobuf
const PROTO_PATH = path.join(__dirname, './protos/chat.proto');
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

// Normalize order action from new format to enum value
// Handles: ADD, REMOVE, EMPTY_CART, QUERY_CART
// Enum values: 0=ADD, 1=REMOVE, 2=EMPTY_CART
// The LLM is responsible for calculating quantity differences (e.g., current=1, target=5 → ADD 4)
function normalizeOrders(actions) {
  if (!actions || !Array.isArray(actions)) {
    return [];
  }

  const result = [];

  for (const action of actions) {
    const type = (action.type || action.action || '').toUpperCase();

    switch (type) {
      case 'ADD':
        result.push({
          action: 0,
          item: action.item || '',
          quantity: action.quantity || 1
        });
        break;

      case 'REMOVE':
        result.push({
          action: 1,
          item: action.item || '',
          quantity: action.quantity || 1
        });
        break;

      case 'EMPTY_CART':
        result.push({
          action: 2,
          item: '',
          quantity: 1
        });
        break;

      case 'QUERY_CART':
        // User is just asking about cart - no action needed
        // Don't add anything to result
        break;

      default:
        console.warn('Unknown action type:', type);
    }
  }

  return result;
}

// Parse LLM response to extract orders and metadata
// Validate LLM output for security issues
function validateLLMOutput(text) {
  if (!text || typeof text !== 'string') {
    return { valid: false, reason: 'Empty or invalid response' };
  }

  // Check for control token leakage (model trying to manipulate its own prompt)
  const suspiciousPatterns = [
    /<\|start_header_id\|>/i,
    /<\|end_header_id\|>/i,
    /<\|eot_id\|>/i,
    /<\|begin_of_text\|>/i,
    /\[USER_INPUT\]/i,
    /\[\/USER_INPUT\]/i,
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(text)) {
      console.warn('⚠️ SECURITY: Detected control token in LLM output, rejecting response');
      return { valid: false, reason: 'Invalid response format' };
    }
  }

  // Check for out-of-character responses (role-playing as something else)
  const outOfCharacterPatterns = [
    /\b(ahoy|matey|arr+|ye|yer|shiver me timbers)\b/i, // pirate speak
    /\b(thee|thou|thy|hath|doth)\b/i, // shakespearean
    /\b(beep|boop|robot|compute)\b/i, // robot speak
    /01010\d+/, // binary
    /\*[^*]+\*/g, // roleplay actions like *tips hat*
  ];

  for (const pattern of outOfCharacterPatterns) {
    if (pattern.test(text)) {
      console.warn('⚠️ SECURITY: Detected out-of-character response (possible jailbreak)');
      return { valid: false, reason: 'Out of character response' };
    }
  }

  // Check for excessively long responses (possible DoS or jailbreak attempt)
  const MAX_RESPONSE_LENGTH = 2000;
  if (text.length > MAX_RESPONSE_LENGTH) {
    console.warn('⚠️ SECURITY: Response exceeds maximum length');
    return { valid: false, reason: 'Response too long' };
  }

  return { valid: true };
}

function parseOrders(text) {
  // Handle empty or whitespace-only text
  if (!text || text.trim().length === 0) {
    return {
      orders: [],
      message: "I'm sorry, I couldn't generate a response. Please try again.",
      meta: { clarify: false, clarify_question: null }
    };
  }

  // Validate LLM output for security issues
  const validation = validateLLMOutput(text);
  if (!validation.valid) {
    console.error('LLM output validation failed:', validation.reason);
    return {
      orders: [],
      message: "I apologize, but I couldn't process that request properly. Please try rephrasing.",
      meta: { clarify: false, clarify_question: null }
    };
  }

  // New format: plain text message followed by JSON object on new line
  // Expected format:
  // Your friendly message here
  // {"actions": [...], "meta": {...}}

  const lines = text.trim().split('\n');
  let message = '';
  let actions = [];
  let meta = { clarify: false, clarify_question: null };

  // Try to find the JSON line (should contain "actions" field)
  let jsonLineIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{') && line.includes('"actions"')) {
      jsonLineIndex = i;
      break;
    }
  }

  if (jsonLineIndex !== -1) {
    // Extract message (everything before the JSON line)
    message = lines.slice(0, jsonLineIndex).join('\n').trim();

    // Extract and parse JSON line
    const jsonLine = lines[jsonLineIndex].trim();
    try {
      const parsed = JSON.parse(jsonLine);
      if (parsed.actions && Array.isArray(parsed.actions)) {
        actions = normalizeOrders(parsed.actions);
      }
      if (parsed.meta) {
        meta = parsed.meta;
      }
    } catch (e) {
      console.error('Error parsing actions JSON:', e);
      console.error('JSON line:', jsonLine);
      // Continue with empty actions array
    }
  } else {
    // Fallback: no JSON found, treat entire text as message
    message = text.trim();
  }

  return {
    orders: actions,
    message: message || "How can I help you?",
    meta: meta
  };
}

// Chat service implementation
const chatService = {
  processChat: async (call, callback) => {
    try {
      const { text, history, user_id, cart_context } = call.request;

      // Format prompt and generate response
      const prompt = formatPrompt(text, history || [], cart_context || '');

      // Call llama service
      const response = await fetch(`${LLAMA_SERVICE_URL}/completion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          n_predict: 512,
          temperature: 0.7
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
      const { text, history, user_id, cart_context } = call.request;

      const prompt = formatPrompt(text, history || [], cart_context || '');

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