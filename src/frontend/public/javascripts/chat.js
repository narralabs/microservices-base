document.addEventListener('DOMContentLoaded', () => {
  const messageInput = document.querySelector('.message-input');
  const sendButton = document.querySelector('.send-button');
  const chatMessages = document.querySelector('.chat-messages');

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

  function sendMessage(text) {
    // Create a message element for the assistant response
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant-message';
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Use EventSource for SSE streaming
    const eventSource = new EventSource(`/chat/stream?text=${encodeURIComponent(text)}`);

    let fullResponse = '';

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.error) {
          messageDiv.textContent = 'Sorry, there was an error processing your request.';
          eventSource.close();
          return;
        }

        // Append content as it arrives
        if (data.content) {
          fullResponse += data.content;
          messageDiv.textContent = fullResponse;
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        // Handle final message with orders
        if (data.is_final) {
          displayOrders(data.orders);
          eventSource.close();
        }
      } catch (error) {
        console.error('Error parsing SSE data:', error);
        messageDiv.textContent = 'Sorry, there was an error processing your request.';
        eventSource.close();
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE Error:', error);
      if (fullResponse === '') {
        messageDiv.textContent = 'Sorry, there was an error processing your request.';
      }
      eventSource.close();
    };
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
