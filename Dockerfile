
# Use the official Puppeteer image which includes Chrome
FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root to install dependencies if needed, though usually puppeteer user is fine for running script
# But we need to install npm packages globally or locally.
USER root

WORKDIR /app

# Skip downloading Chromium as we use the installed one
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies to verify we only need production ones
# But wait, 'ts-node' is devDependency? No, we build to JS.
# We need 'puppeteer', 'puppeteer-extra', 'resend' in dependencies.
RUN npm prune --production

# Switch back to pptruser for security (and consistency with base image)
# We run as root to ensure we can write to mounted volumes easily without permission issues
# USER pptruser

# Command to run the application
CMD ["node", "dist/index.js"]
