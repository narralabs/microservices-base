var express = require('express');
var router = express.Router();

const PROTO_PATH = "./proto/app.proto";

const grpc = require("@grpc/grpc-js");
const protoLoader = require('@grpc/proto-loader');

const options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

const packageDefinition = protoLoader.loadSync(PROTO_PATH, options);

const UserService = grpc.loadPackageDefinition(packageDefinition).app.UserService;

const client = new UserService(
  process.env.USERSERVICE_URL,
  grpc.credentials.createInsecure()
);

router.get('/', function(req, res, next) {
  console.log('Make listUsers gRPC call to UserService');
  client.listUsers({}, (err, response) => {
    console.log('Got response for listUsers gRPC call: ', response);
    if (err) {
      res.status(500).send('Internal Server Error');
    }
    res.json(response.users);
  });
});

module.exports = router;
