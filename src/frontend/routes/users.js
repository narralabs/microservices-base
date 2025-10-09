var express = require('express');
var router = express.Router();

const PROTO_PATH = "./protos/app.proto";

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
  process.env.USER_SERVICE_URL,
  grpc.credentials.createInsecure()
);

router.get('/', function(req, res, next) {
  console.log('Make listUsers gRPC call to UserService');
  client.listUsers({}, (err, response) => {
    console.log('Got response for listUsers gRPC call: ', response);
    if (err) {
      const errorMessage = err.details || err.message || 'Internal Server Error';
      res.status(500).send(errorMessage);
      return;
    }
    res.render('users', { title: 'Users', users: response.users });
  });
});


module.exports = router;
