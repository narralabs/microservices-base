# microservices-base

The microservices-base project is a base template for creating a microservices based architecture.
It is using protobuf for communication between services. The services are using nodejs by default
but is flexible enough to be replaced with other languages like Go, Python, etc.

## Requirements

- [Docker](https://docs.docker.com/get-docker/)
- [Kubernetes](https://kubernetes.io/)
- [Skaffold](https://skaffold.dev/) (for simplifying development by automating building, pushing and deploying)
- [Minikube](https://minikube.sigs.k8s.io/docs/) (for creating a local k8s cluster)

## Local Development Using Docker Compose

When developing locally we recommend that you use docker-compose. This is because docker-compose is easier to
setup and supports running one-off containers. This is helpful when adding npm packages among other things that
skaffold + minikube does not support.

1. Clone the repository
2. Download the AI model into the `src/llama-service/models` folder: `curl -L "https://huggingface.co/unsloth/Llama-3.1-8B-Instruct-GGUF/resolve/main/Llama-3.1-8B-Instruct-Q4_K_M.gguf" -o src/llama-service/models/model.gguf`
3. Start the services: `docker compose up`
4. Open the frontend: `http://localhost:3000`

## Local k8s Development Using Skaffold + Minikube

Only use local k8s (via minikube) when you want to test the local k8s cluster that mimics production. In you're
planning to do local development, please use docker-compose. This is more of a sanity check to make sure the k8s
configuration is working locally before deploying to production.

The local k8s requires that you download the model and server locally before starting the cluster. This is to speed
up local builds since llama-service needs to download the model everytime before starting.

1. Clone the repository
2. Download the AI model once: `curl -L "https://huggingface.co/unsloth/Llama-3.1-8B-Instruct-GGUF/resolve/main/Llama-3.1-8B-Instruct-Q4_K_M.gguf" -o src/llama-service/models/model.gguf`
3. Start a local python server to serve the AI model: `cd src/llama-service/models && python3 -m http.server 8000`
4. Start the k8s cluster: `minikube start`
5. Run development environment: `skaffold dev`
6. In another terminal, open the tunnel: `minikube tunnel`
7. Open the frontend: `http://localhost:3000`
