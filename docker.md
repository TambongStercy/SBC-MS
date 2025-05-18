# docker-compose.yml
version: '3.8'

services:
  user-service:
    build:
      context: ./user-service # Path to your user-service directory containing its Dockerfile
      dockerfile: Dockerfile.dev # Optional: use a specific Dockerfile for development
    ports:
      - "3001:3001" # Map host port 3001 to container port 3001
    volumes:
      - ./user-service/src:/usr/src/app/src # Map your local src to the container's app src
      # You might also want to map package.json and install node_modules in the container
      # or use a more sophisticated setup to avoid mapping node_modules from the host
      - ./user-service/package.json:/usr/src/app/package.json
      - ./user-service/package-lock.json:/usr/src/app/package-lock.json
      # A common practice is to have node_modules only inside the container:
      # - /usr/src/app/node_modules # Anonymous volume to prevent host node_modules from overwriting container's
    command: npm run dev # This script in your package.json would run nodemon
    environment:
      - NODE_ENV=development
      - PORT=3001
      # ... other environment variables
    # depends_on: # If it depends on other services like a database
    #   - user-db

  nginx-gateway: # Your Nginx gateway
    image: nginx:alpine # Or build from a custom Dockerfile if you have one
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro # Mount your Nginx config
      # If serving static files directly via Nginx from a service
      # - ./payment-service/public:/usr/share/nginx/html/payment-service-static
    depends_on:
      - user-service
      - notification-service # Add all your backend services here
      # ... other services

  # Define other services like notification-service, payment-service, etc.
  notification-service:
    build: ./notification-service
    command: npm run dev
    volumes:
      - ./notification-service/src:/usr/src/app/src
      - ./notification-service/package.json:/usr/src/app/package.json
      - ./notification-service/package-lock.json:/usr/src/app/package-lock.json
    ports:
      - "3002:3002" # Ensure unique host ports if exposing multiple services directly
    environment:
      - NODE_ENV=development
      - PORT=3002

  # ... and so on for all your microservices