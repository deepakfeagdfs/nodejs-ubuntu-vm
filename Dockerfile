FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install basics + node + git
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    build-essential

# Install Node.js (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Create app directory
WORKDIR /app

# Clone your repo
RUN git clone https://github.com/IamGunpoint/nodejs-ubuntu-vm.git .

# Install dependencies
RUN npm install || true

# Expose port (change if your server uses different)
EXPOSE 7860

# Run server.js
CMD ["node", "server.js"]
