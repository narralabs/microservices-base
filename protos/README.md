# protos

The protos folder contains the definition for the Protocol Buffers used
in the application.

Whenever you edit the `app.proto` file. You need to generate the proto files
for the services.

For a nodejs based service, you simply need to copy the `app.proto` file to the
`proto` folder in the nodejs services folder. If you have a service named
`userservice`, then copy the `app.proto` file to `userservice/proto/app.proto`.

This proto generation process is automated via a `update_protos` script.
Everytime you update the protobuf file, simply run `./update_protos` and it
should do the generation.

## How To Use

1. Modify app.proto
2. Generate proto files: `./update_protos`
3. You should see the change in the `proto` or `genproto` folder in the services
