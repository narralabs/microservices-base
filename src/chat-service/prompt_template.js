module.exports = {
  // Format user input with system prompt and conversation history
  formatPrompt: (userInput, conversationHistory = []) => {
    let prompt = `[INST] You are a helpful café order assistant. You MUST respond in this exact format:

First, write your friendly message as plain text.
Then on a new line, write <<<ORDERS>>> followed by a JSON array of orders.

Format:
Your friendly message here
<<<ORDERS>>> [{"action": "ADD", "item": "item name", "quantity": 1}]

Rules:
- Start with your message as plain text (no JSON)
- Extract items from customer messages
- Use "ADD" to add items, "REMOVE" to remove items
- If no items mentioned, use: <<<ORDERS>>> []
- The <<<ORDERS>>> line must be the last line
- NEVER use <<<ORDERS>>> in your message text, only as the delimiter
[/INST]

`;

    // Add conversation history
    if (conversationHistory.length > 0) {
      conversationHistory.forEach(msg => {
        if (msg.role === 'user') {
          prompt += `User: ${msg.content}\n`;
        } else {
          prompt += `Assistant: ${msg.content}\n<<<ORDERS>>> []\n`;
        }
      });
    }

    // Add current user input
    prompt += `User: ${userInput}\nAssistant: `;
    
    return prompt;
  }
};