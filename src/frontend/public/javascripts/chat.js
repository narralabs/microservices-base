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

  async function sendMessage(text) {
    try {
      const response = await fetch('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const data = await response.json();
      addMessage(data.response, false);
      displayOrders(data.orders);
    } catch (error) {
      console.error('Error:', error);
      addMessage('Sorry, there was an error processing your request.', false);
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
