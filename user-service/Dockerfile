FROM node:18-slim AS base
WORKDIR /usr/src/app
# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Development stage
FROM base AS development
ENV NODE_ENV=development

# Install build tools needed for native modules (Debian-based)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++

# Clean npm cache and remove entire node_modules directory before install
RUN npm cache clean --force && rm -rf node_modules

# Install all dependencies, including devDependencies
RUN npm install --verbose

# Copy the rest of the application source code
COPY . .
# Expose the port the app runs on (matching docker-compose and service config)
EXPOSE 3001
# Default command to run the app in development mode using nodemon
CMD ["npm", "run", "dev"]

# Builder stage (for production)
FROM base AS builder
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++
# Install only production dependencies and build the app
RUN npm ci --only=production
COPY . .
RUN npm run build

# Production stage
FROM node:18-slim AS production
ENV NODE_ENV=production
WORKDIR /usr/src/app
# Copy artifacts from builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/dist ./dist
# Expose the port the app runs on (matching docker-compose and service config)
EXPOSE 3001
# Command to run the optimized production build
CMD ["node", "dist/server.js"] 