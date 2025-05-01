# Product Service

This microservice is responsible for managing products in the SBC marketplace, including:
- Product creation, updating, and deletion
- Product search with filtering and pagination
- Product approval workflow
- Product ratings and reviews

## Features

- **Product Management**: CRUD operations for products
- **Search & Filtering**: Advanced search with multiple filters (price, category, etc.)
- **Rating System**: User ratings with review text and helpful counter
- **Admin Workflow**: Product approval/rejection process
- **Authentication**: JWT-based authentication
- **Authorization**: Role-based access control

## Tech Stack

- Node.js & Express
- TypeScript
- MongoDB with Mongoose
- JWT for authentication

## Setup & Installation

1. **Clone the repository**

2. **Install dependencies**:
   ```bash
   cd product-service
   npm install
   ```

3. **Environment Setup**:
   Create a `.env` file in the product-service directory with the following variables:
   ```
   NODE_ENV=development
   PORT=4004
   MONGO_URI=mongodb://localhost:27017/sbc_product_service
   JWT_SECRET=your-jwt-secret
   SERVICE_SECRET=your-service-to-service-secret
   ```

4. **Start the service**:
   - Development mode: `npm run dev`
   - Production mode: `npm run build && npm start`

## API Endpoints

### Public Endpoints

- `GET /api/products/search` - Search products with filters
- `GET /api/products/:productId` - Get a specific product
- `GET /api/products/:productId/ratings` - Get ratings for a product

### Authenticated User Endpoints

- `POST /api/products` - Create a new product
- `GET /api/products/user` - Get user's products
- `PUT /api/products/:productId` - Update a product
- `DELETE /api/products/:productId` - Delete a product
- `POST /api/products/:productId/ratings` - Rate a product
- `DELETE /api/products/ratings/:ratingId` - Delete a rating
- `POST /api/products/ratings/:ratingId/helpful` - Mark a rating as helpful
- `GET /api/products/user/ratings` - Get user's ratings

### Admin Endpoints

- `PATCH /api/products/:productId/status` - Update product status (approve/reject)

## Database Models

### Product Model

- `userId`: Reference to the user who created the product
- `name`: Product name
- `category`: Product category
- `subcategory`: Product subcategory (optional)
- `description`: Product description
- `imagesUrl`: Array of image URLs
- `price`: Product price
- `ratings`: Array of references to Rating documents
- `overallRating`: Average rating (calculated)
- `status`: Product status (PENDING, APPROVED, REJECTED)
- `rejectionReason`: Reason for rejection (if status is REJECTED)
- Timestamps and soft delete fields

### Rating Model

- `userId`: Reference to the user who created the rating
- `productId`: Reference to the product being rated
- `rating`: Numeric rating (1-5)
- `review`: Text review (optional)
- `helpful`: Counter for users who found this review helpful
- Timestamps and soft delete fields

## Architecture

The service follows a clean architecture pattern:
- **Controllers**: Handle HTTP requests and responses
- **Services**: Implement business logic
- **Repositories**: Handle database operations
- **Models**: Define data structure
- **Middleware**: Handle cross-cutting concerns (auth, validation, etc.)

## Error Handling

The service uses custom error handling with appropriate HTTP status codes:
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error 