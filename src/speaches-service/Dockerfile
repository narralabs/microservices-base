FROM ghcr.io/speaches-ai/speaches:latest-cpu

# Download the STT model during build
USER ubuntu
RUN huggingface-cli download Systran/faster-distil-whisper-small.en
RUN huggingface-cli download speaches-ai/Kokoro-82M-v1.0-ONNX-fp16

# The default command from the base image will be used (speaches serve)

