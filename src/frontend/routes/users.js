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
      return;
    }
    res.render('users', { title: 'Users', users: response.users });
  });
});

router.get('/create', function(req, res, next) {
  res.render('create-user', { title: 'Create New User' });
});

router.post('/create', function(req, res, next) {
  const user = {
    first_name: req.body.firstName,
    last_name: req.body.lastName,
    email: req.body.email
  };

  console.log('Make createUser gRPC call to UserService');
  client.createUser(user, (err, response) => {
    if (err) {
      console.error('Error creating user:', err);
      res.status(500).send('Error creating user');
      return;
    }
    res.redirect('/users');
  });
});

module.exports = router;
