const express = require('express');
const router = express.Router();
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const jwt = require('jsonwebtoken');
const { redirectIfAuthenticated } = require('../middleware/auth');

const PROTO_PATH = __dirname + '/../proto/app.proto';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'localhost:7000';

// Load proto file
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const userService = new protoDescriptor.app.UserService(
  USER_SERVICE_URL,
  grpc.credentials.createInsecure()
);

// Promisify gRPC methods
const loginAsync = (credentials) => {
  return new Promise((resolve, reject) => {
    userService.login(credentials, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
};

// Routes
router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('login', { title: 'Login' });
});

router.post('/login', redirectIfAuthenticated, async (req, res) => {
  try {
    const { email, password } = req.body;

    const response = await loginAsync({ email, password });

    // Store tokens
    res.cookie('refreshToken', response.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Store user info in session
    req.session.user = response.user;
    req.session.accessToken = response.access_token;

    res.redirect('/');
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', {
      title: 'Login',
      error: 'Invalid email or password'
    });
  }
});

router.get('/logout', (req, res) => {
  // Clear session
  req.session = null;

  // Clear refresh token cookie
  res.clearCookie('refreshToken');

  res.redirect('/auth/login');
});

module.exports = router;
