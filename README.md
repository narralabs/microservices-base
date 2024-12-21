# microservices-base

The microservices-base project is a base template for creating a microservices based architecture.
It is using protobuf for communication between services. The services are using nodejs by default
but is flexible enough to be replaced with other languages like Go, Python, etc.

## Requirements

- [Docker](https://docs.docker.com/get-docker/)
- [Kubernetes](https://kubernetes.io/)
- [Skaffold](https://skaffold.dev/) (for simplifying development by automating building, pushing and deploying)
- [Minikube](https://minikube.sigs.k8s.io/docs/) (for creating a local k8s cluster)

## Getting Started

1. Clone the repository
2. Start the k8s cluster: `minikube start`
3. Run development environment: `skaffold dev`
4. In another terminal, open the tunnel: `minikube tunnel`
5. Open the frontend: `http://localhost:3000`
