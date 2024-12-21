const grpc = require("@grpc/grpc-js");
const protoLoader = require('@grpc/proto-loader');

const PORT = process.env.PORT || 7000;
const PROTO_PATH = "./proto/app.proto";

const options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

function listUsers(_, callback) {
  console.log('getAllUsers called!')
  const users = [
    {
      id: 1,
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com'
    }
  ];
  callback(null, {users});
}

const packageDefinition = protoLoader.loadSync(PROTO_PATH, options);
const appProto = grpc.loadPackageDefinition(packageDefinition).app;

function main () {
  console.log(`Starting UserService server on port ${PORT}...`);
  const server = new grpc.Server();
  server.addService(appProto.UserService.service, {listUsers});
  server.bindAsync(
    `0.0.0.0:${PORT}`,
    grpc.ServerCredentials.createInsecure(),
    function() {
      console.log(`UserService server on port ${PORT}`);
      server.start();
    },
   );
}

main();