FROM node:18-slim AS base
WORKDIR /usr/src/app
# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Development stage
FROM base AS development
ENV NODE_ENV=development

# Install build tools needed for native modules (Debian-based)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ curl

# Clean npm cache and remove entire node_modules directory before install
RUN npm cache clean --force && rm -rf node_modules

# Install all dependencies, including devDependencies
RUN npm install --verbose

# Copy the rest of the application source code
COPY . .
# Expose the port the app runs on
EXPOSE 3000
# Default command to run the app in development mode using nodemon
CMD ["npm", "run", "dev"]

# Builder stage (for production)
FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++
# Install all dependencies (including devDependencies for TypeScript compilation)
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:18-slim AS production
ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy package files and install production dependencies only
COPY --from=builder /usr/src/app/package*.json ./
RUN npm ci --only=production
# Copy compiled code
COPY --from=builder /usr/src/app/dist ./dist
# Expose the port the app runs on
EXPOSE 3000
# Command to run the optimized production build
CMD ["node", "dist/server.js"]
