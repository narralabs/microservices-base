FROM ghcr.io/ggml-org/llama.cpp:server

# Create models directory (will be mounted from PVC in k8s)
RUN mkdir -p /models

# Expose the server port
EXPOSE 8080

# The CMD options and arguments are to be set in the higher level
# abstraction via docker-compose.yml or k8s-manifests/llama-service.yaml
