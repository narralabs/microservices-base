const grpc = require("@grpc/grpc-js");
const protoLoader = require('@grpc/proto-loader');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 7000;
const PROTO_PATH = "./proto/app.proto";
const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/';

let db;

async function connectToMongo() {
  try {
    const client = await MongoClient.connect(MONGODB_URL);
    db = client.db('userdb');
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }
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
    if (!call.request.first_name || !call.request.last_name || !call.request.email) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: 'First name, last name, and email are required'
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

    const user = {
      first_name: call.request.first_name,
      last_name: call.request.last_name,
      email: call.request.email
    };

    const result = await db.collection('users').insertOne(user);

    // Return the created user with MongoDB's _id as string id field
    const createdUser = {
      id: result.insertedId.toString(),
      ...user
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
        createUser
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