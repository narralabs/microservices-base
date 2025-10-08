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

  function displayOrders(orders) {
    if (!orders || orders.length === 0) return;

    const ordersList = document.createElement('div');
    ordersList.className = 'orders-list';

    orders.forEach(order => {
      const orderItem = document.createElement('div');
      orderItem.className = `order-item ${order.action.toLowerCase()}`;
      orderItem.textContent = `${order.action}: ${order.quantity}x ${order.item}`;
      ordersList.appendChild(orderItem);
    });

    chatMessages.appendChild(ordersList);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function sendMessage(text) {
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
      // Use fetch with POST for SSE streaming
      const response = await fetch('/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          history: conversationHistory
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
                return;
              }

              // Display streaming content (now plain text, not JSON)
              if (data.content) {
                fullResponse += data.content;
                hasReceivedContent = true;

                // Buffer approach: prevent partial "<<<ORDERS>>>" delimiter from showing
                const delimiter = '<<<ORDERS>>>';
                let displayText = fullResponse;

                // Check if we have the complete delimiter
                if (fullResponse.includes(delimiter)) {
                  // Full delimiter found, show everything before it
                  displayText = fullResponse.split(delimiter)[0].trim();
                } else {
                  // No complete delimiter yet - check if we might be in the middle of typing it
                  // Remove any partial match at the end to prevent "ORD", "ORDERS" flashing
                  for (let i = 1; i < delimiter.length; i++) {
                    const partialDelimiter = delimiter.substring(0, i);
                    if (fullResponse.endsWith(partialDelimiter)) {
                      // Found a partial match at the end, don't display it
                      displayText = fullResponse.slice(0, -i).trim();
                      break;
                    }
                  }
                }

                // Only show text if we have something to display, otherwise keep the "..."
                messageDiv.textContent = displayText || '...';
                chatMessages.scrollTop = chatMessages.scrollHeight;
              }

              // Handle final message with orders
              if (data.is_final) {
                // Display only the parsed message (no JSON artifacts)
                if (data.final_message) {
                  finalMessage = data.final_message;
                  messageDiv.textContent = data.final_message;
                } else if (fullResponse) {
                  // Fallback to full response if no final_message
                  finalMessage = fullResponse.split('<<<ORDERS>>>')[0].trim();
                  messageDiv.textContent = finalMessage;
                } else if (!hasReceivedContent) {
                  // Show error if nothing was received
                  messageDiv.textContent = 'Sorry, I could not generate a response.';
                  messageDiv.classList.add('error-message');
                }
                displayOrders(data.orders);

                // Add to conversation history
                conversationHistory.push({ role: 'user', content: text });
                conversationHistory.push({ role: 'assistant', content: finalMessage });
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
});
