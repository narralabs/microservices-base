const grpc = require("@grpc/grpc-js");
const protoLoader = require('@grpc/proto-loader');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const { generateTokens, verifyAccessToken, verifyRefreshToken } = require('./utils/jwt');

const PORT = process.env.PORT || 7000;
const PROTO_PATH = "./protos/app.proto";
const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/';

let db;

async function connectToMongo(retries = 5, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await MongoClient.connect(MONGODB_URL);
      db = client.db('userdb');
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

async function listUsers(_, callback) {
  console.log('listUsers called!');
  try {
    const users = await db.collection('users').find().toArray();
    // Map MongoDB _id to id field for each user
    const mappedUsers = users.map(user => ({
      id: user._id.toString(),
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email
    }));
    callback(null, { users: mappedUsers });
  } catch (err) {
    console.error('Error fetching users:', err);
    callback({
      code: grpc.status.INTERNAL,
      details: 'Internal server error'
    });
  }
}

async function createUser(call, callback) {
  console.log('createUser called with data:', call.request);
  try {
    // Validate required fields
    if (!call.request.first_name || !call.request.last_name || !call.request.email || !call.request.password) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: 'First name, last name, email, and password are required'
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(call.request.email)) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: 'Invalid email format'
      });
    }

    // Check if email already exists
    const existingUser = await db.collection('users').findOne({ email: call.request.email });
    if (existingUser) {
      return callback({
        code: grpc.status.ALREADY_EXISTS,
        details: 'A user with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(call.request.password, 10);

    const user = {
      first_name: call.request.first_name,
      last_name: call.request.last_name,
      email: call.request.email,
      password: hashedPassword,
      role: call.request.role || 'user',
      tokenVersion: 0
    };

    const result = await db.collection('users').insertOne(user);

    // Return the created user with MongoDB's _id as string id field (exclude password)
    const createdUser = {
      id: result.insertedId.toString(),
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role
    };

    console.log('User created:', createdUser);
    callback(null, createdUser);
  } catch (err) {
    console.error('Error creating user:', err);
    callback({
      code: grpc.status.INTERNAL,
      details: 'Internal server error'
    });
  }
}

async function login(call, callback) {
  try {
    const { email, password } = call.request;

    // Find user by email
    const user = await db.collection('users').findOne({ email });
    if (!user) {
      return callback({
        code: grpc.status.NOT_FOUND,
        details: 'Invalid email or password'
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: 'Invalid email or password'
      });
    }

    // Generate tokens
    const tokens = generateTokens({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion
    });

    // Create response (exclude password)
    const response = {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      user: {
        id: user._id.toString(),
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role
      }
    };

    callback(null, response);
  } catch (err) {
    console.error('Error during login:', err);
    callback({
      code: grpc.status.INTERNAL,
      details: 'Internal server error'
    });
  }
}

async function validateToken(call, callback) {
  try {
    const { token } = call.request;
    const result = verifyAccessToken(token);

    if (!result.valid) {
      return callback(null, { valid: false });
    }

    console.log('result', JSON.stringify(result, null, 2));

    // Get user from database to ensure they still exist and have access
    const user = await db.collection('users').findOne({ _id: new ObjectId(result.decoded.id) });
    if (!user) {
      return callback(null, { valid: false });
    }

    callback(null, {
      valid: true,
      user: {
        id: user._id.toString(),
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Error validating token:', err);
    callback({
      code: grpc.status.INTERNAL,
      details: 'Internal server error'
    });
  }
}

async function refreshToken(call, callback) {
  try {
    const { refresh_token } = call.request;
    const result = verifyRefreshToken(refresh_token);

    if (!result.valid) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: 'Invalid refresh token'
      });
    }

    // Get user and verify token version
    const user = await db.collection('users').findOne({ _id: new ObjectId(result.decoded.id) });
    if (!user || user.tokenVersion !== result.decoded.tokenVersion) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: 'Invalid refresh token'
      });
    }

    // Generate new tokens
    const tokens = generateTokens({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion
    });

    callback(null, {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      user: {
        id: user._id.toString(),
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Error refreshing token:', err);
    callback({
      code: grpc.status.INTERNAL,
      details: 'Internal server error'
    });
  }
}

const packageDefinition = protoLoader.loadSync(PROTO_PATH, options);
const appProto = grpc.loadPackageDefinition(packageDefinition).app;

async function main() {
  try {
    await connectToMongo();

    console.log(`Starting UserService server on port ${PORT}...`);
    const server = new grpc.Server();
    server.addService(
      appProto.UserService.service,
      {
        listUsers,
        createUser,
        login,
        validateToken,
        refreshToken
      }
    );

    server.bindAsync(
      `0.0.0.0:${PORT}`,
      grpc.ServerCredentials.createInsecure(),
      function() {
        console.log(`UserService server on port ${PORT}`);
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