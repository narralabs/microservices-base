FROM node:20-slim

WORKDIR /app

# Copy application files
COPY package*.json ./
COPY server.js .
COPY prompt_template.js .
COPY proto/ ./proto/

# Install Node.js dependencies
RUN npm install --production

RUN npm install -g nodemon

# Environment variables
ENV LLAMA_SERVICE_URL=http://llama-service:8080

EXPOSE 50051

CMD ["npm", "start"]