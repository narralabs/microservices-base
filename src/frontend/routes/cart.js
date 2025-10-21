const express = require('express');
const router = express.Router();
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

// Load cart service proto
const PROTO_PATH = path.join(__dirname, '../protos/cart.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const cartProto = protoDescriptor.cart;

// Create gRPC client
const client = new cartProto.CartService(
  process.env.CART_SERVICE_URL,
  grpc.credentials.createInsecure()
);

// Helper function to get user ID (authenticated or anonymous)
function getUserId(req) {
  return req.session?.user?.id || req.session?.anonymousId;
}

// Get cart
router.get('/', async (req, res) => {
  const userId = getUserId(req);

  if (!userId) {
    return res.status(500).json({ error: 'Failed to identify user' });
  }

  client.getCart({ user_id: userId }, (error, response) => {
    if (error) {
      console.error('Error getting cart:', error);
      return res.status(500).json({ error: 'Failed to get cart' });
    }

    res.json(response);
  });
});

// Add item to cart
router.post('/add', async (req, res) => {
  const userId = getUserId(req);
  const { item, quantity } = req.body;

  if (!userId) {
    return res.status(500).json({ error: 'Failed to identify user' });
  }

  if (!item || !quantity) {
    return res.status(400).json({ error: 'Item and quantity are required' });
  }

  client.addItem({ user_id: userId, item, quantity: parseInt(quantity) }, (error, response) => {
    if (error) {
      console.error('Error adding item to cart:', error);
      return res.status(500).json({ error: 'Failed to add item to cart' });
    }

    res.json(response);
  });
});

// Remove item from cart
router.post('/remove', async (req, res) => {
  const userId = getUserId(req);
  const { item, quantity } = req.body;

  if (!userId) {
    return res.status(500).json({ error: 'Failed to identify user' });
  }

  if (!item || !quantity) {
    return res.status(400).json({ error: 'Item and quantity are required' });
  }

  client.removeItem({ user_id: userId, item, quantity: parseInt(quantity) }, (error, response) => {
    if (error) {
      console.error('Error removing item from cart:', error);
      return res.status(500).json({ error: 'Failed to remove item from cart' });
    }

    res.json(response);
  });
});

// Empty cart
router.post('/empty', async (req, res) => {
  const userId = getUserId(req);

  if (!userId) {
    return res.status(500).json({ error: 'Failed to identify user' });
  }

  client.emptyCart({ user_id: userId }, (error, response) => {
    if (error) {
      console.error('Error emptying cart:', error);
      return res.status(500).json({ error: 'Failed to empty cart' });
    }

    res.json(response);
  });
});

module.exports = router;
