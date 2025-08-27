FROM mongo:latest

# Expose the default MongoDB port
EXPOSE 27017

# Create a directory for MongoDB data
RUN mkdir -p /data/db

# Set permissions for the MongoDB data directory
RUN chown -R mongodb:mongodb /data/db

# Command to run MongoDB daemon
CMD ["mongod"]
