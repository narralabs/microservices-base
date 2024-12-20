# microservices-base

The microservices-base project is a base template for creating a microservices based architecture.
It is using protobuf for communication between services. The services are using nodejs by default
but is flexible enough to be replaced with other languages like Go, Python, etc.

## Requirements

- Docker
- Kubernetes
- Skaffold (for simplifying development by automating building, pushing and deploying)
- Minikube (for creating a local k8s cluster)

## Getting Started

1. Clone the repository
2. Start the k8s cluster: `minikube start`
3. Run `skaffold dev` to start the development environment
4. Open the tunnel: `minikube tunnel`
5. Open the frontend: `http://localhost:3000`
