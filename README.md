# microservices-base

The microservices-base project is a base template for creating a microservices based architecture.
It is using protobuf for communication between services. The services are using nodejs by default
but is flexible enough to be replaced with other languages like Go, Python, etc.

## Requirements

- [Docker](https://docs.docker.com/get-docker/)
- [Kubernetes](https://kubernetes.io/)
- [Skaffold](https://skaffold.dev/) (for simplifying development by automating building, pushing and deploying)
- [Minikube](https://minikube.sigs.k8s.io/docs/) (for creating a local k8s cluster)

## Getting Started Local Development

When developing. We recommend you use docke-compose. This is because docker-compose is easier to setup and supports
running one-off containers. This is helpful when adding npm packages among other things that skaffold + minikube
does not support.

1. Clone the repository
2. Start the services: `docker compose up`
3. Open the frontend: `http://localhost:3000`

## Getting Started Local k8s

Only use local k8s when you want to test the local k8s cluster that will mimic production. In development, please
still use docker-compose. This is more of a sanity check to make sure the k8s configuration is working locally
before deploying to production.

1. Clone the repository
2. Start the k8s cluster: `minikube start`
3. Run development environment: `skaffold dev`
4. In another terminal, open the tunnel: `minikube tunnel`
5. Open the frontend: `http://localhost:3000`
