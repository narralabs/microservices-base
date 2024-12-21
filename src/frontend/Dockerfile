FROM node:22.12.0-alpine

WORKDIR /app

COPY . .

RUN npm install -g nodemon

RUN npm install

EXPOSE 3000

CMD ["npm", "start"]