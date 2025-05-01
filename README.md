# Sniper Business Center (SBC) Microservices Backend & Admin Frontend

This repository contains the backend microservices and the admin frontend for the Sniper Business Center (SBC) application.

## Project Overview

The application follows a microservices architecture. Each service is independent, handles a specific business domain, and communicates with others typically via REST APIs through an API Gateway.

**Key Components:**

*   **API Gateway (`gateway-service`):** The single entry point for all client requests. Routes requests to the appropriate downstream microservice.
*   **User Service (`user-service`):** Manages user accounts, authentication, profiles, referrals, and subscriptions.
*   **Payment Service (`payment-service`):** Handles payment processing, transaction history, balances, and payment provider integrations.
*   **Settings Service (`settings-service`):** Manages global application settings, file uploads (proxied to Google Drive), and potentially event configurations.
*   **Product Service (`product-service`):** Manages product information and flash sales (details inferred).
*   **Notification Service (`notification-service`):** Handles sending notifications (email, SMS, push) to users (details inferred).
*   **Tombola Service (`tombola-service`):** Manages tombola/lottery functionality (details inferred).
*   **Advertising Service (`advertising-service`):** Manages advertising features (details inferred).
*   **Admin Frontend (`admin-frontend-ms`):** A React application (likely using Vite) for administrators to manage the platform.

## Prerequisites

*   **Node.js:** (Specify version, e.g., v18.x or later) - Download from [nodejs.org](https://nodejs.org/)
*   **npm** or **yarn:** Package managers for Node.js (usually included with Node.js).
*   **MongoDB:** A running MongoDB instance (local or cloud-hosted like MongoDB Atlas). Configure connection strings in each service's `.env` file.
*   **Git:** For version control.
*   **Google Cloud Service Account:** (For `settings-service`) A service account key file (`google-credentials.json` or similar, configured via `.env`) is needed for Google Drive integration.

## Directory Structure

```
.
├── gateway-service/        # API Gateway
├── user-service/           # User management, auth, subscriptions
├── payment-service/        # Payments, transactions
├── settings-service/       # Global settings, file uploads
├── product-service/        # Product management
├── notification-service/   # Notifications
├── tombola-service/        # Tombola/Lottery
├── advertising-service/    # Advertising features
├── admin-frontend-ms/      # Admin React App
├── .gitignore              # Git ignore configuration
└── README.md               # This file
```

Each service directory (e.g., `user-service/`) contains its own `package.json`, `src/`, `.env.example`, etc.

## Running Services Locally

### Backend Services

Follow these steps for **each** backend microservice (`gateway-service`, `user-service`, `payment-service`, etc.):

1.  **Navigate to the Service Directory:**
    ```bash
    cd service-name
    # Example: cd user-service
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    # or: yarn install
    ```

3.  **Set Up Environment Variables:**
    *   Copy the example environment file:
        ```bash
        cp .env.example .env
        ```
    *   Edit the `.env` file and fill in the required values:
        *   `PORT`: The port the service will run on (e.g., 3001 for user-service). Ensure ports are unique.
        *   `MONGODB_URI`: Connection string for your MongoDB instance.
        *   `JWT_SECRET`: Secret key for signing JWT tokens (should be the same across services needing auth validation if gateway doesn't handle it fully).
        *   `NODE_ENV`: Set to `development`.
        *   `API_GATEWAY_URL`: The URL of the running gateway (e.g., `http://localhost:3000`).
        *   URLs for other services it needs to communicate with (e.g., `PAYMENT_SERVICE_URL`).
        *   Specific secrets (e.g., Google Drive credentials for `settings-service`, payment provider keys for `payment-service`).
        *   `SERVICE_SECRET`: A shared secret used for basic service-to-service authentication (passed in headers).

4.  **Run the Development Server:**
    ```bash
    npm run dev
    # or: yarn dev
    ```
    This typically uses `nodemon` or `ts-node-dev` to watch for file changes and automatically restart the server.

### Admin Frontend (`admin-frontend-ms`)

1.  **Navigate to the Frontend Directory:**
    ```bash
    cd admin-frontend-ms
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    # or: yarn install
    ```

3.  **Set Up Environment Variables:**
    *   Copy the example environment file if it exists:
        ```bash
        # If .env.example exists for the frontend
        # cp .env.example .env
        ```
    *   Edit the `.env` (or `.env.development`) file. The primary variable needed is the URL of the **API Gateway**:
        *   `VITE_API_BASE_URL` (or similar, check the frontend code/config): Set this to the URL of your running API Gateway (e.g., `http://localhost:3000/api`).

4.  **Run the Development Server:**
    ```bash
    npm run dev
    # or: yarn dev
    ```

**Important Order:**

*   Start backend services (`user-service`, `payment-service`, etc.) **before** starting the `gateway-service`.
*   Start the `gateway-service`.
*   Start the `admin-frontend-ms`.

**Accessing:**

*   The **Admin Frontend** will likely be available at `http://localhost:5173` (or another port specified by Vite/React).
*   All **API requests** should go through the **API Gateway** (e.g., `http://localhost:3000/api/users/login`).

## Building for Production

For each backend service and the frontend:

1.  **Navigate to the Service Directory:**
    ```bash
    cd service-name
    ```
2.  **Run the Build Script:**
    ```bash
    npm run build
    # or: yarn build
    ```
    This will typically compile TypeScript to JavaScript and place the output in a `dist/` folder (for backend services) or a `build/` or `dist/` folder (for the frontend).

## Deployment Considerations

Deploying microservices requires careful planning. Here are general strategies:

*   **Containerization (Docker):**
    *   Create a `Dockerfile` for each service.
    *   Build Docker images for each service.
    *   Deploy containers using orchestrators like Docker Compose (for simpler setups), Kubernetes (for complex, scalable deployments), or cloud-specific container services (e.g., AWS ECS, Google Cloud Run, Azure Container Apps).
*   **Serverless Functions:** Deploy individual API endpoints or entire services as serverless functions (e.g., AWS Lambda, Google Cloud Functions, Azure Functions). This requires refactoring services to fit the serverless model.
*   **Virtual Machines (VMs):** Deploy each service (or groups of services) onto separate VMs. Requires manual setup or configuration management tools (Ansible, Chef, Puppet).

**Key Deployment Steps:**

1.  **Environment Variables:** Securely manage production environment variables (database URIs, API keys, JWT secrets, service secrets) using deployment platform secrets management, `.env` files managed by the deployment process (ensure they are *not* committed to Git), or configuration services. **Never commit production secrets to Git.**
2.  **Database:** Set up and configure your production MongoDB instance. Ensure network connectivity from your deployed backend services.
3.  **Build Artifacts:** Build production-ready artifacts for each service (using `npm run build`).
4.  **API Gateway:** Deploy the `gateway-service`. Ensure it's publicly accessible (or via a load balancer) and configured with the correct production URLs/addresses of the downstream microservices. Configure HTTPS.
5.  **Backend Services:** Deploy each backend microservice container/function/VM. Ensure they can communicate with each other and the database.
6.  **Frontend:** Deploy the static build output of the `admin-frontend-ms` to a static web host (e.g., Vercel, Netlify, AWS S3 + CloudFront, GitHub Pages) or serve it via a web server (like Nginx). Configure it to point API requests to the deployed API Gateway's URL.
7.  **HTTPS:** Configure HTTPS/TLS for the API Gateway and the frontend hosting for security.
8.  **Logging & Monitoring:** Set up centralized logging and monitoring solutions to track the health and performance of all services.

## Deploying to a VPS (Simple Method)

This outlines a basic deployment strategy suitable for a single Virtual Private Server (VPS). For more robust deployments, consider containerization (Docker/Kubernetes).

**Prerequisites on VPS:**

*   Git installed.
*   Node.js and npm/yarn installed (match the version used in development).
*   MongoDB installed and running, or accessible via a connection string.
*   A process manager like `pm2` installed globally (`npm install -g pm2`).
*   Firewall configured to allow access to the necessary ports (e.g., 80, 443, Gateway port, Frontend port if served directly).
*   (Recommended) Nginx or Apache configured as a reverse proxy to handle incoming traffic (especially for HTTPS).

**Steps:**

1.  **Clone the Repository:**
    ```bash
    git clone <your-repository-url> sbc-microservices
    cd sbc-microservices
    ```

2.  **Set Up Each Service:** Repeat for **each** backend service (`gateway-service`, `user-service`, etc.):
    *   Navigate to the service directory: `cd service-name`
    *   Install dependencies: `npm install --production` (or `yarn install --production`)
    *   Create the production `.env` file: `cp .env.example .env`
    *   **Crucially, edit the `.env` file with PRODUCTION values:**
        *   Set `NODE_ENV=production`.
        *   Use production database URIs, JWT secrets, API keys, service secrets.
        *   Configure service URLs to point to the correct internal or external addresses/ports on the VPS (e.g., `http://localhost:3001` if running on the same machine, or the VPS IP/domain).
    *   Build the service: `npm run build`
    *   Go back to the root: `cd ..`

3.  **Set Up Admin Frontend:**
    *   Navigate to the frontend directory: `cd admin-frontend-ms`
    *   Install dependencies: `npm install` (Need devDependencies for building)
    *   Create the production `.env` file (e.g., `.env.production`).
    *   Edit the production environment file, setting `VITE_API_BASE_URL` to the **public URL of your deployed API Gateway** (e.g., `https://yourdomain.com/api`).
    *   Build the frontend: `npm run build`
    *   The static files will be in the `dist/` (or `build/`) directory.
    *   Go back to the root: `cd ..`

4.  **Serve the Admin Frontend:**
    *   Configure your reverse proxy (Nginx/Apache) to serve the static files from `admin-frontend-ms/dist`.
    *   Ensure requests to `/api` (or your API base path) are proxied to the running Gateway service.

5.  **Run Backend Services with PM2:** Repeat for **each** backend service (`gateway-service`, `user-service`, etc.):
    *   Navigate to the service directory: `cd service-name`
    *   Start the service using PM2 (run from within the service directory):
        ```bash
        # Adjust 'dist/server.js' to your actual built entry point
        pm2 start dist/server.js --name service-name-prod -- node-args="--env-file=.env"
        # Example:
        # pm2 start dist/server.js --name user-service-prod -- node-args="--env-file=.env"
        ```
        *   `--name`: Gives the process a recognizable name in PM2.
        *   `node-args="--env-file=.env"`: Ensures Node.js loads the correct `.env` file (Requires Node.js v20.6.0+). For older Node versions, you might need `dotenv` package integration in your service startup.
    *   Go back to the root: `cd ..`

6.  **Save PM2 Configuration:**
    ```bash
    pm2 save
    ```
    This saves the list of running processes so PM2 can restart them automatically if the server reboots (requires setting up PM2 startup script: `pm2 startup`).

7.  **Configure Reverse Proxy (Nginx/Apache - Example):**
    *   Set up Nginx/Apache to listen on ports 80/443.
    *   Configure it to proxy requests for `/api/` to your gateway service (e.g., `http://localhost:3000`).
    *   Configure it to serve static files from `admin-frontend-ms/dist/` for the root `/` path.
    *   Set up SSL/TLS certificates (e.g., using Let's Encrypt with Certbot) for HTTPS.

**Updating the Deployment:**

1.  SSH into your VPS.
2.  Navigate to the repository root: `cd sbc-microservices`
3.  Pull the latest changes: `git pull origin main` (or your branch)
4.  Stop the relevant services: `pm2 stop service-name-prod`
5.  Navigate into the updated service directory: `cd service-name`
6.  Install any new dependencies: `npm install --production`
7.  Rebuild the service: `npm run build`
8.  Restart the service: `pm2 restart service-name-prod`
9.  Repeat for other updated services/frontend.

## Contributing

(Optional: Add guidelines if others will contribute)
*   Fork the repository.
*   Create a new branch for your feature or bug fix.
*   Make your changes.
*   Ensure tests pass (if applicable).
*   Submit a pull request.

---

*This README provides a general guide. Specific configuration details are located within each service's `.env.example` file.* 