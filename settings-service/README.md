# Settings Service

This microservice is responsible for managing global application settings for the Sniper Business Center platform, including configuration values and the company logo.

## Purpose

- Provide a central place to store and retrieve application-wide settings.
- Manage the company logo, including upload, storage, and retrieval.
- Offer a proxy endpoint to securely serve the stored company logo.

## Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: MongoDB (via Mongoose)
- **File Storage**: Google Drive API (using a Service Account)
- **Authentication**: JWT (JSON Web Tokens)
- **Logging**: Winston
- **Environment Variables**: dotenv

## Project Structure

```
settings-service/
├── dist/                # Compiled JavaScript output
├── logs/                # Log files (if configured)
├── node_modules/
├── src/
│   ├── api/             # Express routes, controllers, middleware
│   │   ├── controllers/
│   │   ├── middleware/
│   │   └── routes/
│   ├── config/          # Environment configuration loading
│   ├── database/        # Database connection, models, repositories
│   │   ├── models/
│   │   └── repositories/
│   ├── services/        # Business logic (SettingsService, GoogleDriveService)
│   ├── utils/           # Utility functions (logger, errors)
│   └── server.ts        # Express server setup and entry point
├── .env                 # Local environment variables (ignored by git)
├── .env.example         # Example environment variables
├── .gitignore
├── package.json
├── package-lock.json
├── README.md            # This file
└── tsconfig.json        # TypeScript configuration
```

## Setup

1.  **Clone the Repository**: Ensure you have the main project containing this service cloned.
2.  **Navigate to Service Directory**: `cd settings-service`
3.  **Install Dependencies**: `npm install`
4.  **Configure Environment Variables**:
    *   Copy the `.env.example` file to a new file named `.env`: `cp .env.example .env`
    *   Edit the `.env` file and provide values for all the required variables (see below).

## Environment Variables

The following environment variables need to be set in the `.env` file:

- `NODE_ENV`: Application environment (`development`, `production`, etc.)
- `PORT`: Port the service will run on (e.g., `3005`).
- `MONGODB_URI`: Connection string for the MongoDB database.
- `JWT_SECRET`: Secret key for signing and verifying JWT tokens.

**Google Drive Configuration:**

- `DRIVE_CLIENT_EMAIL`: The client email of the Google Cloud Service Account.
- `DRIVE_PRIVATE_KEY`: The private key associated with the Service Account. Ensure newlines are handled correctly (often requires replacing `\n` with actual newlines).
- `DRIVE_SETTINGS_FOLDER_ID`: (Optional but Recommended) The ID of the Google Drive folder where company logos will be stored.
- `SETTINGS_SERVICE_BASE_URL`: The publicly accessible base URL for this service (e.g., `http://localhost:3005`) used to construct the logo proxy URL.

*Note: You need to create a Service Account in your Google Cloud Platform project, enable the Google Drive API, generate credentials (key file), and share the target Google Drive folder with the service account's email address.* Find the Folder ID in the Google Drive URL when viewing the folder.

## API Endpoints

All endpoints are prefixed with `/api/settings`.

- **`GET /`**
    - **Description**: Retrieves the current application settings, including the company logo URL (if set).
    - **Authentication**: Required (Bearer Token).
    - **Response**: `{ success: true, data: { /* settings object */ } }` or `{ success: true, data: null }` if no settings exist.

- **`POST /logo`**
    - **Description**: Uploads or replaces the company logo.
    - **Authentication**: Required (Bearer Token).
    - **Request**: `multipart/form-data` with a file field named `companyLogo`.
    - **Response**: `{ success: true, data: { /* updated settings object */ }, message: '...' }`

- **`GET /files/:fileId`**
    - **Description**: Proxies and serves the content of a file stored in Google Drive (used for the company logo and generic uploads). The `fileId` is obtained from the `companyLogo.fileId` field in the settings object or from the response of the generic upload endpoint.
    - **Authentication**: None (typically public access is needed).
    - **Response**: The file content with appropriate `Content-Type` and `Content-Length` headers.

- **`POST /files/upload` (Generic Upload)**
    - **Description**: Uploads a generic file to Google Drive for use by other microservices.
    - **Authentication**: Required (Bearer Token - standard user/service auth for now).
    - **Request**: `multipart/form-data` with a file field named `file`.
    - **Allowed File Types**: Images (JPG, PNG, GIF, WEBP, SVG), PDF, Office Docs (DOC, DOCX, XLS, XLSX, PPT, PPTX), TXT, CSV.
    - **Max Size**: 10MB (configurable).
    - **Response**: `{ success: true, data: { fileId: string, url: string, fileName: string, mimeType: string, size: number }, message: 'File uploaded successfully.' }`
        - `url`: The proxy URL to access the file (e.g., `/api/settings/files/FILE_ID`).

## Running the Service

- **Development Mode (with hot-reloading)**:
  ```bash
  npm run dev
  ```
- **Production Mode (requires build step first)**:
  ```bash
  npm run build
  npm start
  ```

## Logging

Logs are managed by Winston and configured via environment variables (`LOG_LEVEL`, `LOG_DIR`). By default, logs may be output to the console and/or files in the `logs/` directory. 