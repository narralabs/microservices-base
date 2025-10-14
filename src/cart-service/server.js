const grpc = require("@grpc/grpc-js");
const protoLoader = require('@grpc/proto-loader');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 7002;
const PROTO_PATH = "./protos/cart.proto";
const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/';

let db;

async function connectToMongo(retries = 5, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await MongoClient.connect(MONGODB_URL);
      db = client.db('cartdb');
      console.log('Connected to MongoDB');
      return;
    } catch (err) {
      console.error(`Failed to connect to MongoDB (attempt ${i + 1}/${retries}):`, err.message);
      if (i < retries - 1) {
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  console.error('Failed to connect to MongoDB after all retries');
  process.exit(1);
}

const options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

// Helper function to calculate total items
function calculateTotalItems(items) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

// Helper function to build cart response
function buildCartResponse(cart) {
  if (!cart || !cart.items) {
    return {
      user_id: cart?.user_id || '',
      items: [],
      total_items: 0
    };
  }
  
  return {
    user_id: cart.user_id,
    items: cart.items,
    total_items: calculateTotalItems(cart.items)
  };
}

async function addItem(call, callback) {
  console.log('addItem called with:', call.request);
  try {
    const { user_id, item, quantity } = call.request;

    // Validate inputs
    if (!user_id || !item || quantity === undefined || quantity <= 0) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: 'user_id, item, and positive quantity are required'
      });
    }

    // Find existing cart or create new one
    let cart = await db.collection('carts').findOne({ user_id });

    if (!cart) {
      // Create new cart
      cart = {
        user_id,
        items: [{ item, quantity }]
      };
      await db.collection('carts').insertOne(cart);
    } else {
      // Check if item already exists in cart
      const existingItemIndex = cart.items.findIndex(i => i.item === item);

      if (existingItemIndex >= 0) {
        // Update quantity of existing item
        cart.items[existingItemIndex].quantity += quantity;
      } else {
        // Add new item to cart
        cart.items.push({ item, quantity });
      }

      // Update cart in database
      await db.collection('carts').updateOne(
        { user_id },
        { $set: { items: cart.items } }
      );
    }

    console.log('Item added to cart:', cart);
    callback(null, buildCartResponse(cart));
  } catch (err) {
    console.error('Error adding item to cart:', err);
    callback({
      code: grpc.status.INTERNAL,
      details: 'Internal server error'
    });
  }
}

async function removeItem(call, callback) {
  console.log('removeItem called with:', call.request);
  try {
    const { user_id, item, quantity } = call.request;

    // Validate inputs
    if (!user_id || !item || quantity === undefined || quantity <= 0) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: 'user_id, item, and positive quantity are required'
      });
    }

    // Find cart
    let cart = await db.collection('carts').findOne({ user_id });

    if (!cart) {
      return callback({
        code: grpc.status.NOT_FOUND,
        details: 'Cart not found'
      });
    }

    // Find item in cart
    const existingItemIndex = cart.items.findIndex(i => i.item === item);

    if (existingItemIndex < 0) {
      return callback({
        code: grpc.status.NOT_FOUND,
        details: 'Item not found in cart'
      });
    }

    // Reduce quantity or remove item
    cart.items[existingItemIndex].quantity -= quantity;

    if (cart.items[existingItemIndex].quantity <= 0) {
      // Remove item completely if quantity is 0 or less
      cart.items.splice(existingItemIndex, 1);
    }

    // Update cart in database
    await db.collection('carts').updateOne(
      { user_id },
      { $set: { items: cart.items } }
    );

    console.log('Item removed from cart:', cart);
    callback(null, buildCartResponse(cart));
  } catch (err) {
    console.error('Error removing item from cart:', err);
    callback({
      code: grpc.status.INTERNAL,
      details: 'Internal server error'
    });
  }
}

async function emptyCart(call, callback) {
  console.log('emptyCart called with:', call.request);
  try {
    const { user_id } = call.request;

    // Validate inputs
    if (!user_id) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: 'user_id is required'
      });
    }

    // Update cart to have empty items array
    await db.collection('carts').updateOne(
      { user_id },
      { $set: { items: [] } },
      { upsert: true }
    );

    console.log('Cart emptied for user:', user_id);
    callback(null, buildCartResponse({ user_id, items: [] }));
  } catch (err) {
    console.error('Error emptying cart:', err);
    callback({
      code: grpc.status.INTERNAL,
      details: 'Internal server error'
    });
  }
}

async function getCart(call, callback) {
  console.log('getCart called with:', call.request);
  try {
    const { user_id } = call.request;

    // Validate inputs
    if (!user_id) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: 'user_id is required'
      });
    }

    // Find cart
    const cart = await db.collection('carts').findOne({ user_id });

    if (!cart) {
      // Return empty cart if not found
      return callback(null, buildCartResponse({ user_id, items: [] }));
    }

    console.log('Cart retrieved:', cart);
    callback(null, buildCartResponse(cart));
  } catch (err) {
    console.error('Error getting cart:', err);
    callback({
      code: grpc.status.INTERNAL,
      details: 'Internal server error'
    });
  }
}

const packageDefinition = protoLoader.loadSync(PROTO_PATH, options);
const cartProto = grpc.loadPackageDefinition(packageDefinition).cart;

async function main() {
  try {
    await connectToMongo();

    console.log(`Starting CartService server on port ${PORT}...`);
    const server = new grpc.Server();
    server.addService(
      cartProto.CartService.service,
      {
        addItem,
        removeItem,
        emptyCart,
        getCart
      }
    );

    server.bindAsync(
      `0.0.0.0:${PORT}`,
      grpc.ServerCredentials.createInsecure(),
      function() {
        console.log(`CartService server on port ${PORT}`);
        server.start();
      }
    );
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
