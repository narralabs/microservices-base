var express = require('express');
var router = express.Router();
const { redirectIfAuthenticated } = require('../middleware/auth');

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

router.get('/', redirectIfAuthenticated, function(req, res, next) {
  res.render('create-user', { title: 'Sign Up' });
});

router.post('/', redirectIfAuthenticated, function(req, res, next) {
  const { firstName, lastName, email, password, confirmPassword } = req.body;

  // Validate password requirements
  if (!password || password.length < 8) {
    return res.render('create-user', {
      title: 'Sign Up',
      error: 'Password must be at least 8 characters long',
      user: { first_name: firstName, last_name: lastName, email }
    });
  }

  // Check if password contains both letters and numbers
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return res.render('create-user', {
      title: 'Sign Up',
      error: 'Password must contain both letters and numbers',
      user: { first_name: firstName, last_name: lastName, email }
    });
  }

  // Check if passwords match
  if (password !== confirmPassword) {
    return res.render('create-user', {
      title: 'Sign Up',
      error: 'Passwords do not match',
      user: { first_name: firstName, last_name: lastName, email }
    });
  }

  // Create request object matching CreateUserRequest proto message
  const createUserRequest = {
    first_name: firstName,
    last_name: lastName,
    email: email,
    password: password,
    role: 'user'  // Default role for new users
  };

  console.log('Make createUser gRPC call to UserService');
  client.createUser(createUserRequest, (err, response) => {
    if (err) {
      console.error('Error creating user:', err);
      const errorMessage = err.details || err.message || 'Failed to create user. Please try again.';
      // Re-render the form with error message and previous input values
      res.render('create-user', {
        title: 'Sign Up',
        error: errorMessage,
        user: { first_name: firstName, last_name: lastName, email }
      });
      return;
    }
    // Redirect to login page after successful registration
    res.redirect('/login');
  });
});

module.exports = router;
