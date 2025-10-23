FROM node:18-alpine

RUN npm install -g nodemon

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

EXPOSE 8001

CMD ["node", "server.js"]

