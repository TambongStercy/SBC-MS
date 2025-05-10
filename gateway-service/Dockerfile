# 1. Base Image: Use an official Node.js image.
# Choose a version that matches your project's requirements (e.g., 18, 20, etc.)
FROM node:18-alpine AS builder

# 2. Set Working Directory
WORKDIR /usr/src/app

# 3. Copy package.json and package-lock.json (or yarn.lock)
# This step is separated to leverage Docker's layer caching.
# If these files haven't changed, Docker won't re-run npm install.
COPY package*.json ./
# If you use yarn:
# COPY yarn.lock ./
# COPY package.json ./

# 4. Install Dependencies
# Use --only=production if you don't need devDependencies in the final image,
# but for TypeScript projects, you often need devDependencies (like typescript itself) for the build step.
RUN npm install
# If you use yarn:
# RUN yarn install

# 5. Copy the rest of your application's source code
COPY . .

# 6. Transpile TypeScript to JavaScript (if applicable)
# This command might vary based on your tsconfig.json (e.g., 'npm run build', 'yarn build')
# Ensure your package.json has a "build" script that compiles TypeScript.
RUN npm run build
# If your build output is in a different directory (e.g., 'dist'), note that for the next stage.

# --- Production Stage ---
FROM node:18-alpine AS production

WORKDIR /usr/src/app

# Copy only necessary files from the builder stage
# This includes node_modules and the compiled JavaScript output (e.g., 'dist' folder)
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package*.json ./
# If your build output is in 'dist':
COPY --from=builder /usr/src/app/dist ./dist
# If your build output is directly in the root (less common for TS):
# COPY --from=builder /usr/src/app/build ./ # or wherever your JS files are

# Expose the port your application runs on (replace 3000 with your service's port)
EXPOSE 3000

# Define the command to run your application
# This should point to your compiled JavaScript entry file.
# Example if your entry file is dist/server.js:
CMD [ "node", "dist/server.js" ]
# Example if your entry file is directly in root (e.g., server.js after compilation):
# CMD [ "node", "server.js" ]
