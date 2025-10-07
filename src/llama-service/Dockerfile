FROM ghcr.io/ggml-org/llama.cpp:server

# Create models directory (will be mounted from PVC in k8s)
RUN mkdir -p /models

# Expose the server port
EXPOSE 8080

# Set environment variables for the server
ENV MODEL=/models/mistral-7b-instruct-v0.2.Q4_K_M.gguf
ENV N_CTX=2048
ENV N_THREADS=4

# Model is provided via volume mount (downloaded by initContainer in k8s)
CMD ["--host", "0.0.0.0", "--port", "8080", "-m", "/models/mistral-7b-instruct-v0.2.Q4_K_M.gguf", "-c", "2048", "-t", "4"]
