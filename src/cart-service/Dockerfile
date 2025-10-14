FROM node:22.12.0-alpine

WORKDIR /app

RUN npm install -g nodemon

RUN apk add --no-cache protobuf

RUN npm install -g grpc-tools
RUN npm install -g protoc-gen-js

COPY . .

RUN npm install

EXPOSE 7002

CMD ["node", "server.js"]
