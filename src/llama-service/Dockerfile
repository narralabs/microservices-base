FROM ghcr.io/ggml-org/llama.cpp:server

# Copy the model file
COPY models/mistral-7b-instruct-v0.2.Q4_K_M.gguf /models/

# Expose the server port
EXPOSE 8080

# Set environment variables for the server
ENV MODEL=/models/mistral-7b-instruct-v0.2.Q4_K_M.gguf
# Metal GPU support is enabled via command line flag
ENV N_CTX=2048
ENV N_THREADS=4
