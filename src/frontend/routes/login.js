var express = require('express');
var router = express.Router();
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { authenticateUser, redirectIfAuthenticated } = require('../middleware/auth');

// Load cart service proto
const CART_PROTO_PATH = path.join(__dirname, '../protos/cart.proto');
const cartPackageDefinition = protoLoader.loadSync(CART_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const cartProtoDescriptor = grpc.loadPackageDefinition(cartPackageDefinition);
const cartProto = cartProtoDescriptor.cart;

// Create gRPC client for cart service
const cartClient = new cartProto.CartService(
  process.env.CART_SERVICE_URL,
  grpc.credentials.createInsecure()
);

router.get('/', redirectIfAuthenticated, function(req, res, next) {
  res.render('login', { title: 'Login' });
});

router.post('/', redirectIfAuthenticated, async function(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await authenticateUser(email, password);

    if (result.success) {
      // Save the anonymous ID before updating session
      const anonymousId = req.session.anonymousId;

      // Set the access token in session
      req.session.accessToken = result.token;
      req.session.user = result.user;

      // Set the refresh token in an HTTP-only cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      // Merge anonymous cart with authenticated user's cart (fire and forget)
      if (anonymousId) {
        mergeAnonymousCart(anonymousId, result.user.id);
        // Clear the anonymous ID from session
        delete req.session.anonymousId;
      }

      res.redirect('/');
    } else {
      res.render('login', {
        title: 'Login',
        error: result.error || 'Invalid email or password'
      });
    }
  } catch (error) {
    next(error);
  }
});

// Helper function to merge anonymous cart with authenticated user's cart
function mergeAnonymousCart(anonymousId, userId) {
  // Single RPC call to merge carts
  cartClient.mergeCart(
    {
      anonymous_user_id: anonymousId,
      authenticated_user_id: userId
    },
    (error, response) => {
      if (error) {
        console.error('Error merging carts:', error);
      } else {
        console.log('Carts merged successfully:', response);
      }
    }
  );
}

module.exports = router;
