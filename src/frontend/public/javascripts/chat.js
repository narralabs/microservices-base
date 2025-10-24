document.addEventListener('DOMContentLoaded', () => {
  const messageInput = document.querySelector('.message-input');
  const sendButton = document.querySelector('.send-button');
  const chatMessages = document.querySelector('.chat-messages');

  // Track conversation history
  let conversationHistory = [];

  function addMessage(text, isUser = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'assistant-message'}`;
    messageDiv.textContent = text;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function processOrders(orders) {
    if (!orders || orders.length === 0) return;

    for (const order of orders) {
      try {
        let endpoint;
        let body = {};

        // Determine endpoint based on action
        if (order.action === 'EMPTY_CART' || order.action === 2) {
          endpoint = '/cart/empty';
          // No body needed for empty cart
        } else if (order.action === 'REMOVE' || order.action === 1) {
          endpoint = '/cart/remove';
          body = {
            item: order.item,
            quantity: order.quantity
          };
        } else {
          // ADD (0) or default
          endpoint = '/cart/add';
          body = {
            item: order.item,
            quantity: order.quantity
          };
        }

        await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body)
        });
      } catch (error) {
        console.error('Error processing order:', error);
      }
    }
  }

  function displayOrders(orders) {
    if (!orders || orders.length === 0) return;

    const ordersList = document.createElement('div');
    ordersList.className = 'orders-list';

    orders.forEach(order => {
      const orderItem = document.createElement('div');
      const actionName = order.action === 2 || order.action === 'EMPTY_CART' ? 'empty_cart' :
                         order.action === 1 || order.action === 'REMOVE' ? 'remove' : 'add';
      orderItem.className = `order-item ${actionName}`;

      if (order.action === 2 || order.action === 'EMPTY_CART') {
        orderItem.textContent = `EMPTY_CART: Cart cleared`;
      } else {
        orderItem.textContent = `${order.action}: ${order.quantity}x ${order.item}`;
      }
      ordersList.appendChild(orderItem);
    });

    chatMessages.appendChild(ordersList);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function sendMessage(text) {
    // Disable only the send button while waiting for response (allow continued typing)
    sendButton.disabled = true;

    // Create a message element for the assistant response
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant-message';
    messageDiv.textContent = '...'; // Loading indicator
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    let fullResponse = '';
    let finalMessage = '';
    let hasReceivedContent = false;

    try {
      // Get current cart items (from cart.js cached data - no fetch needed)
      let cartItems = [];
      if (window.getCartItems) {
        cartItems = window.getCartItems();
      }

      // Use fetch with POST for SSE streaming
      const response = await fetch('/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          history: conversationHistory,
          cart_items: cartItems
        })
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.error) {
                messageDiv.textContent = `Error: ${data.error}`;
                messageDiv.classList.add('error-message');
                // Re-enable the send button
                sendButton.disabled = false;
                return;
              }

              // Display streaming content (plain text message)
              if (data.content) {
                fullResponse += data.content;
                hasReceivedContent = true;

                // Buffer approach: prevent partial JSON line from showing
                // We want to show the message but hide the JSON line
                let displayText = fullResponse;

                // Split by newlines to detect if we're starting to see JSON
                const lines = fullResponse.split('\n');
                const lastLine = lines[lines.length - 1].trim();

                // If the last line looks like it might be the start of JSON, don't show it
                if (lastLine.startsWith('{') || lastLine.startsWith('{"')) {
                  // Hide the potential JSON line
                  displayText = lines.slice(0, -1).join('\n').trim();
                } else {
                  displayText = fullResponse.trim();
                }

                // Only show text if we have something to display, otherwise keep the "..."
                messageDiv.textContent = displayText || '...';
                chatMessages.scrollTop = chatMessages.scrollHeight;
              }

              // Handle final message with orders
              if (data.is_final) {
                // Display only the parsed message (no JSON line)
                if (data.final_message) {
                  finalMessage = data.final_message;
                  messageDiv.textContent = data.final_message;
                } else if (fullResponse) {
                  // Fallback: extract message part (everything before JSON line)
                  const lines = fullResponse.split('\n');
                  let messageLines = [];
                  for (const line of lines) {
                    if (line.trim().startsWith('{') && line.includes('"actions"')) {
                      break; // Stop at JSON line
                    }
                    messageLines.push(line);
                  }
                  finalMessage = messageLines.join('\n').trim();
                  messageDiv.textContent = finalMessage;
                } else if (!hasReceivedContent) {
                  // Show error if nothing was received
                  messageDiv.textContent = 'Sorry, I could not generate a response.';
                  messageDiv.classList.add('error-message');
                }

                // Process and display orders
                if (data.orders && data.orders.length > 0) {
                  await processOrders(data.orders);
                  displayOrders(data.orders);
                  // Refresh cart to show updated items
                  if (window.refreshCart) {
                    window.refreshCart();
                  }
                }

                // Add to conversation history
                // Save the full response with JSON format so the LLM learns the correct format
                conversationHistory.push({ role: 'user', content: text });
                
                // Reconstruct the full response with actions for history (using "type" field)
                let fullAssistantResponse = finalMessage + '\n';
                
                // Convert orders back to the new type-based format for history
                const actions = [];
                if (data.orders && data.orders.length > 0) {
                  for (const order of data.orders) {
                    if (order.action === 2) {
                      actions.push({ type: 'EMPTY_CART' });
                    } else if (order.action === 1) {
                      actions.push({ type: 'REMOVE', item: order.item, quantity: order.quantity });
                    } else {
                      actions.push({ type: 'ADD', item: order.item, quantity: order.quantity });
                    }
                  }
                }
                
                fullAssistantResponse += JSON.stringify({
                  actions: actions,
                  meta: { clarify: false, clarify_question: null }
                });
                
                conversationHistory.push({ role: 'assistant', content: fullAssistantResponse });

                // Re-enable the send button
                sendButton.disabled = false;

                // Emit event for voice assistant to request TTS
                if (finalMessage) {
                  window.dispatchEvent(new CustomEvent('chat-response-complete', {
                    detail: { text: finalMessage }
                  }));
                }
              }
            } catch (error) {
              console.error('Error parsing SSE data:', error);
            }
          }
        }
      }
    } catch (error) {
      console.error('SSE Error:', error);
      messageDiv.textContent = 'Sorry, there was an error processing your request.';
      // Re-enable the send button
      sendButton.disabled = false;
    }
  }

  // Handle send button click
  sendButton.addEventListener('click', () => {
    const text = messageInput.value.trim();
    if (text) {
      addMessage(text, true);
      messageInput.value = '';
      sendMessage(text);
    }
  });

  // Handle enter key
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendButton.click();
    }
  });

  // Export functions for use by audio.js
  window.addChatMessage = addMessage;
  window.sendChatMessage = sendMessage;
});
