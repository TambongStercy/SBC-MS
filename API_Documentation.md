# SBC Microservices API Documentation

This document outlines the API endpoints provided by the various microservices within the Sniper Business Center (SBC) project.

## General Conventions

*   **Base Path:** All user-facing API routes are proxied through an API gateway (e.g., Nginx). The base path for all service APIs is typically `/api`. The gateway configuration determines the final path exposed to the client.
*   **Authentication:**
    *   Routes requiring user authentication use a Bearer token (JWT) in the `Authorization` header. Middleware (`authenticate`) validates this token.
    *   Internal service-to-service communication uses a separate authentication mechanism (`authenticateServiceRequest`), likely based on a shared secret or specific service tokens.
    *   Admin routes require both authentication and role-based authorization (`authorize([UserRole.ADMIN])`).
*   **Response Format:**
    *   **Success:** Consistent format preferred: `{ success: true, data: {...} }` or `{ success: true, message: '...', data: {...} }`.
    *   **Error:** Consistent format preferred: `{ success: false, message: '...', errors: [...] }` or `{ success: false, error: '...' }`. Appropriate HTTP status codes (4xx, 500) should be used.
*   **Rate Limiting:** Various rate limiters (`strictLimiter`, `mediumLimiter`, `generalLimiter`, `adminLimiter`, `webhookLimiter`, `uploadLimiter`) are applied to specific endpoints or groups of endpoints to prevent abuse.
*   **Input Validation:** Request bodies and parameters should be validated at the controller or middleware level.

## API Gateway Routing (Conceptual)

The API Gateway routes incoming requests to the appropriate microservice based on the path prefix. (Note: This is a conceptual representation based on typical microservice patterns and observed route files; the exact gateway configuration may differ).

| Incoming Path Prefix    | Target Service        | Notes                                         |
| :---------------------- | :-------------------- | :-------------------------------------------- |
| `/api/users`            | `user-service`        | User registration, login, profile, etc.       |
| `/api/users/internal`   | `user-service`        | Service-to-service user operations            |
| `/api/users/admin`            | `user-service`        | **Admin Login and User Management**           |
| `/api/subscriptions`    | `user-service`        | Subscription management                       |
| `/api/contacts`         | `user-service`        | Contact searching and exporting             |
| `/api/daily-withdrawals`| `user-service`        | Admin routes for daily withdrawals          |
| `/api/payments`         | `payment-service`     | Payment intents, webhooks                   |
| `/api/payments/internal`| `payment-service`     | Service-to-service payment operations         |
| `/api/payments/admin`   | `payment-service`     | Admin routes for payment transactions/stats   |
| `/api/transactions`     | `payment-service`     | User transaction history, initiation        |
| `/api/transactions/admin`| `payment-service`    | Admin routes for account transactions         |
| `/api/products`         | `product-service`     | Product creation, search, ratings           |
| `/api/products/admin`   | `product-service`     | Admin product management                      |
| `/api/flash-sales`      | `product-service`     | Flash sale creation, management, tracking   |
| `/api/flash-sales/admin`| `product-service`     | Admin flash sale management                   |
| `/api/settings`         | `settings-service`    | Site settings, file uploads/retrieval       |
| `/api/events`           | `settings-service`    | Event management                            |
| `/api/tombola`          | `tombola-service`     | Tombola viewing, ticket purchase            |
| `/api/tombola/admin`    | `tombola-service`     | Admin tombola management, draws             |
| `/api/advertising`      | `advertising-service` | Ad packs, ad creation, display            |
| `/api/notifications`    | `notification-service`| User notifications, internal sending        |

**Important:** The path `/api/admin` appears to route directly to the `user-service`'s admin routes, suggesting user-related admin tasks (user management, balance adjustments, etc.) are handled there. Other services (`payment-service`, `product-service`, `tombola-service`) have their own `/admin` sub-paths (e.g., `/api/payments/admin`, `/api/products/admin`) for managing service-specific resources.

## Endpoints by Service

---

### 1. User Service (`user-service`)

Handles user identity, profiles, authentication, subscriptions, referrals, and contacts.

**Base Path (Conceptual):** `/api` (Routed via Gateway)

**Route Files:**

*   `user.routes.ts`
*   `admin.routes.ts`
*   `subscription.routes.ts`
*   `contact.routes.ts`
*   `daily-withdrawal.routes.ts`

**Endpoints:**

| Method | Path                                      | Description                                         | Auth       | Middleware/Limiter          |
| :----- | :---------------------------------------- | :-------------------------------------------------- | :--------- | :-------------------------- |
| POST   | `/users/register`                         | Register a new user                                 | Public     | `mediumLimiter`             |
| POST   | `/users/login`                            | Log in a user                                       | Public     | `strictLimiter`             |
| POST   | `/users/verify-otp`                       | Verify OTP for registration/login                   | Public     | `strictLimiter`             |
| GET    | `/users/get-affiliation`                  | Get user info by referral code                      | Public     |                             |
| GET    | `/users/avatar/:fileId`                   | Get user avatar image (proxied)                     | Public     |                             |
| GET    | `/users/me`                               | Get current user's profile                          | User       | `generalLimiter`            |
| POST   | `/users/logout`                           | Log out the current user                            | User       | `generalLimiter`            |
| GET    | `/users/affiliator`                       | Get the user who referred the current user          | User       | `generalLimiter`            |
| PUT    | `/users/me`                               | Update current user's profile                       | User       | `generalLimiter`            |
| PUT    | `/users/me/avatar`                        | Upload/Update current user's avatar               | User       | `uploadLimiter`, `uploadAvatar` |
| GET    | `/users/get-refered-users`                | Get users referred by the current user              | User       | `generalLimiter`            |
| GET    | `/users/get-referals`                     | Get referral statistics for the current user        | User       | `generalLimiter`            |
| GET    | `/users/get-products`                     | Get products listed by the current user             | User       | `generalLimiter`            |
| GET    | `/users/get-product`                      | Get a specific product listed by the current user   | User       | `generalLimiter`            |
| POST   | `/users/admin/login`                            | Log in an admin user                                | Public     | `strictLimiter`             |
| GET    | `/users/admin/dashboard`                        | Get admin dashboard data                            | Admin      | `adminLimiter`              |
| GET    | `/users/admin/users`                            | List all users (admin view, filters)              | Admin      | `adminLimiter`              |
| GET    | `/users/admin/users/unpaid-initial`             | Export users without initial subscription           | Admin      | `adminLimiter`              |
| GET    | `/users/admin/users/:userId`                    | Get details for a specific user (admin view)      | Admin      | `adminLimiter`              |
| PUT    | `/users/admin/users/:userId`                    | Update user details (admin)                       | Admin      | `adminLimiter`              |
| PATCH  | `/users/admin/users/:userId/block`              | Block a user                                        | Admin      | `adminLimiter`              |
| PATCH  | `/users/admin/users/:userId/unblock`            | Unblock a user                                      | Admin      | `adminLimiter`              |
| DELETE | `/users/admin/users/:userId`                    | Soft delete a user                                  | Admin      | `adminLimiter`              |
| PATCH  | `/users/admin/users/:userId/restore`            | Restore a soft-deleted user                       | Admin      | `adminLimiter`              |
| POST   | `/users/admin/users/:userId/adjust-balance`     | Adjust a user's balance (admin)                   | Admin      | `adminLimiter`              |
| PATCH  | `/users/admin/users/:userId/subscription`       | Set/Update a user's subscription type (admin)       | Admin      | `adminLimiter`              |
| GET    | `/users/admin/users/:userId/subscriptions`      | Get subscriptions for a specific user (admin)       | Admin      | `adminLimiter`              |
| GET    | `/users/admin/stats/user-summary`               | Get user summary statistics (admin)                 | Admin      | `adminLimiter`              |
| GET    | `/users/admin/stats/balance-by-country`         | Get balance aggregated by country (admin)           | Admin      | `adminLimiter`              |
| GET    | `/users/admin/stats/monthly-activity`           | Get monthly registration/subscription stats (admin) | Admin      | `adminLimiter`              |
| GET    | `/subscriptions/plans`                    | Get available subscription plans                    | Public     |                             |
| POST   | `/subscriptions/purchase`                 | Initiate subscription purchase                      | User       | `generalLimiter`            |
| POST   | `/subscriptions/upgrade`                  | Initiate subscription upgrade                       | User       | `generalLimiter`            |
| POST   | `/subscriptions/webhooks/payment-confirmation` | Webhook for payment service confirmation          | Internal   | `webhookLimiter`            |
| GET    | `/subscriptions`                          | Get current user's subscription history             | User       | `generalLimiter`            |
| GET    | `/subscriptions/active`                   | Get current user's active subscriptions           | User       | `generalLimiter`            |
| GET    | `/subscriptions/expired`                  | Get current user's expired subscriptions          | User       | `generalLimiter`            |
| GET    | `/subscriptions/check/:type`              | Check if user has active subscription of type       | User       | `generalLimiter`            |
| GET    | `/contacts/search`                        | Search contacts based on criteria                   | User       | `generalLimiter`            |
| GET    | `/contacts/export`                        | Export filtered contacts as CSV                     | User       | `generalLimiter`            |
| GET    | `/daily-withdrawals`                      | List all daily withdrawals (admin)                  | Admin      |                             |
| GET    | `/daily-withdrawals/date-range`           | Get daily withdrawals within a date range (admin)   | Admin      |                             |
| GET    | `/daily-withdrawals/stats`                | Get overall daily withdrawal stats (admin)          | Admin      |                             |
| GET    | `/users/internal/:userId/balance`         | Get user balance (internal)                         | Service    |                             |
| POST   | `/users/internal/:userId/balance`         | Update user balance (internal)                      | Service    |                             |
| GET    | `/users/internal/:userId/validate`        | Validate user existence and status (internal)     | Service    |                             |
| POST   | `/users/internal/:userId/withdrawal-limits/check` | Check withdrawal limits (internal)           | Service    |                             |
| GET    | `/users/internal/:userId/referrers`       | Get referrer IDs for commission (internal)          | Service    |                             |
| POST   | `/users/internal/find-by-criteria`        | Find users matching criteria (internal)             | Service    |                             |
| POST   | `/users/internal/batch-details`           | Get details for multiple user IDs (internal)        | Service    |                             |
| GET    | `/users/internal/search-ids`              | Find user IDs by search term (internal)             | Service    |                             |

---

### 2. Payment Service (`payment-service`)

Handles payment processing, transaction logging, and related webhooks.

**Base Path (Conceptual):** `/api` (Routed via Gateway)

**Route Files:**

*   `payment.routes.ts`
*   `transaction.routes.ts`
*   `internal.routes.ts`

**Endpoints:**

| Method | Path                                     | Description                                               | Auth       | Middleware/Limiter |
| :----- | :--------------------------------------- | :-------------------------------------------------------- | :--------- | :----------------- |
| GET    | `/payments/page/:sessionId`              | Render custom payment page for a session                  | Public     |                    |
| POST   | `/payments/intents`                      | Create a payment intent (returns session URL)             | Public     | `validatePaymentIntent` |
| POST   | `/payments/intents/:sessionId/submit`    | Submit payment details and initiate provider payment      | Public     | `validatePaymentDetails` |
| GET    | `/payments/intents/:sessionId/status`    | Check payment status for a session                        | Public     |                    |
| POST   | `/payments/webhooks/feexpay`             | Webhook endpoint for Feexpay notifications              | Public     |                    |
| POST   | `/payments/webhooks/cinetpay`            | Webhook endpoint for CinetPay notifications             | Public     |                    |
| GET    | `/transactions/history`                  | Get current user's transaction history                    | User       |                    |
| GET    | `/transactions/stats`                    | Get current user's transaction statistics                 | User       |                    |
| GET    | `/transactions/:transactionId`           | Get details of a specific transaction                     | User       |                    |
| POST   | `/transactions/deposit/initiate`         | Initiate a deposit                                        | User       |                    |
| POST   | `/transactions/deposit/callback`         | Callback/Webhook for deposit status updates             | Service    |                    |
| POST   | `/transactions/withdrawal/initiate`      | Initiate a withdrawal                                     | User       |                    |
| POST   | `/transactions/withdrawal/verify`        | Verify a withdrawal (e.g., OTP)                         | User       |                    |
| POST   | `/transactions/payment`                  | Process a generic payment                                   | User       |                    |
| GET    | `/payments/admin/transactions`           | List all payment transactions (admin)                     | Admin      |                    |
| GET    | `/payments/admin/stats/total-withdrawals`| Get total withdrawal amount stat (admin)                | Admin      |                    |
| GET    | `/payments/admin/stats/total-revenue`    | Get total revenue stat (admin)                            | Admin      |                    |
| GET    | `/payments/admin/stats/monthly-revenue`  | Get monthly revenue stats (admin)                         | Admin      |                    |
| GET    | `/payments/admin/stats/activity-overview`| Get payment activity overview stats (admin)               | Admin      |                    |
| GET    | `/transactions/admin`                    | List all account transactions (admin)                     | Admin      |                    |
| POST   | `/payments/internal/deposit`             | Record an internal deposit (e.g., commission)             | Service    |                    |
| POST   | `/payments/internal/withdrawal`          | Record an internal withdrawal (e.g., fee)               | Service    |                    |

---

### 3. Product Service (`product-service`)

Manages products, categories, ratings, and flash sales.

**Base Path (Conceptual):** `/api` (Routed via Gateway)

**Route Files:**

*   `product.routes.ts`
*   `flashsale.routes.ts`

**Endpoints:**

| Method | Path                                        | Description                                           | Auth    | Middleware/Limiter |
| :----- | :------------------------------------------ | :---------------------------------------------------- | :------ | :----------------- |
| GET    | `/products/search`                          | Search for products                                   | Public  |                    |
| GET    | `/products/:productId`                      | Get details of a specific product                     | Public  |                    |
| GET    | `/products/:productId/ratings`              | Get ratings for a specific product                  | Public  |                    |
| GET    | `/products/user`                            | Get products listed by the current user             | User    |                    |
| GET    | `/products/user/ratings`                    | Get ratings given by the current user               | User    |                    |
| POST   | `/products`                                 | Create a new product                                  | User    |                    |
| PUT    | `/products/:productId`                      | Update a product owned by the current user          | User    |                    |
| DELETE | `/products/:productId`                      | Soft delete a product owned by the current user     | User    |                    |
| POST   | `/products/:productId/ratings`              | Add/Update rating for a product                     | User    |                    |
| DELETE | `/products/ratings/:ratingId`               | Delete a rating given by the current user           | User    |                    |
| POST   | `/products/ratings/:ratingId/helpful`       | Mark a rating as helpful                            | User    |                    |
| GET    | `/products/admin`                           | List all products (admin view, filters)             | Admin   |                    |
| PATCH  | `/products/admin/:productId/status`         | Update product status (approve/reject)              | Admin   |                    |
| DELETE | `/products/admin/:productId/hard`           | Hard delete a product (admin)                         | Admin   |                    |
| PATCH  | `/products/admin/:productId/restore`        | Restore a soft-deleted product (admin)              | Admin   |                    |
| GET    | `/flash-sales`                              | Get active flash sales                                | Public  |                    |
| POST   | `/flash-sales/:flashSaleId/track-view`      | Track a view on a flash sale                          | Public  |                    |
| POST   | `/flash-sales/:flashSaleId/track-whatsapp-click` | Track a WhatsApp click on a flash sale             | Public  |                    |
| POST   | `/flash-sales`                              | Create a new flash sale                               | User    |                    |
| GET    | `/flash-sales/my`                           | Get flash sales created by the current user         | User    |                    |
| PUT    | `/flash-sales/:flashSaleId`                 | Update a flash sale owned by the current user       | User    |                    |
| DELETE | `/flash-sales/:flashSaleId`                 | Cancel a flash sale owned by the current user       | User    |                    |
| GET    | `/flash-sales/admin`                        | List all flash sales (admin view)                   | Admin   |                    |
| GET    | `/flash-sales/admin/:flashSaleId`           | Get specific flash sale details (admin)             | Admin   |                    |
| PUT    | `/flash-sales/admin/:flashSaleId`           | Update any flash sale (admin)                       | Admin   |                    |
| DELETE | `/flash-sales/admin/:flashSaleId`           | Delete/cancel any flash sale (admin)                | Admin   |                    |
| PATCH  | `/flash-sales/admin/:flashSaleId/status`    | Manually update flash sale status (admin)           | Admin   |                    |
| POST   | `/flash-sales/internal/update-payment-status` | Update flash sale payment status (internal webhook) | Service |                    |

---

### 4. Settings Service (`settings-service`)

Handles global application settings and file uploads (logo, terms, videos, avatars).

**Base Path (Conceptual):** `/api` (Routed via Gateway)

**Route Files:**

*   `settings.routes.ts`
*   `event.routes.ts`

**Endpoints:**

| Method | Path                        | Description                                  | Auth    | Middleware/Limiter |
| :----- | :-------------------------- | :------------------------------------------- | :------ | :----------------- |
| GET    | `/settings/files/:fileId`   | Get uploaded file content (e.g., logo, avatar) | Public  | `cors`             |
| GET    | `/settings`                 | Get current application settings             | User    |                    |
| PUT    | `/settings`                 | Update application settings (non-file)       | User    |                    |
| POST   | `/settings/logo`            | Upload/Update company logo                   | User    | `upload.single`    |
| POST   | `/settings/terms-pdf`       | Upload/Update terms PDF                      | User    | `upload.single`    |
| POST   | `/settings/presentation-video` | Upload/Update presentation video             | User    | `upload.single`    |
| POST   | `/settings/presentation-pdf` | Upload/Update presentation PDF               | User    | `upload.single`    |
| POST   | `/settings/files/upload`    | Upload a generic file (e.g., avatar)         | User    | `upload.single`    |
| GET    | `/events`                   | List events (paginated, sorted)              | Public  |                    |
| GET    | `/events/:id`               | Get a specific event by ID                   | Public  |                    |
| POST   | `/events`                   | Create a new event                           | User    | `upload.fields`    |
| PUT    | `/events/:id`               | Update an existing event                     | User    | `upload.fields`    |
| DELETE | `/events/:id`               | Delete an event by ID                        | User    |                    |

---

### 5. Tombola Service (`tombola-service`)

Manages monthly tombolas, ticket purchases, and winner draws.

**Base Path (Conceptual):** `/api` (Routed via Gateway)

**Route Files:**

*   `tombola.routes.ts`

**Endpoints:**

| Method | Path                              | Description                                    | Auth       | Middleware/Limiter |
| :----- | :-------------------------------- | :--------------------------------------------- | :--------- | :----------------- |
| GET    | `/tombola`                        | List current/past tombolas                     | Public     |                    |
| GET    | `/tombola/current`                | Get details of the current open tombola        | Public     |                    |
| GET    | `/tombola/:monthId/winners`       | Get winners for a specific tombola month     | Public     |                    |
| POST   | `/tombola/current/buy-ticket`     | Initiate ticket purchase                       | User       |                    |
| GET    | `/tombola/tickets/me`             | Get tickets purchased by the current user    | User       |                    |
| POST   | `/tombola/webhooks/payment-confirmation` | Webhook for payment confirmation             | Service    |                    |
| POST   | `/tombola/admin`                  | Create a new TombolaMonth (admin)              | Admin      |                    |
| POST   | `/tombola/admin/:monthId/draw`    | Trigger the winner draw (admin)                | Admin      |                    |
| GET    | `/tombola/admin`                  | List all tombola months (admin)                | Admin      |                    |
| GET    | `/tombola/admin/:monthId`         | Get details for a specific tombola month (admin)| Admin      |                    |
| GET    | `/tombola/admin/:monthId/tickets` | List tickets for a specific month (admin)    | Admin      |                    |
| GET    | `/tombola/admin/:monthId/ticket-numbers` | Get all ticket numbers for a month (admin) | Admin      |                    |
| DELETE | `/tombola/admin/:monthId`         | Delete a TombolaMonth (admin)                | Admin      |                    |
| PATCH  | `/tombola/admin/:monthId/status`  | Update tombola status (OPEN/CLOSED) (admin)  | Admin      |                    |

---

### 6. Advertising Service (`advertising-service`)

Handles advertising packs and ad creation/display.

**Base Path (Conceptual):** `/api` (Routed via Gateway)

**Route Files:**

*   `advertising.routes.ts`

**Endpoints:**

| Method | Path                            | Description                               | Auth    | Middleware/Limiter |
| :----- | :------------------------------ | :---------------------------------------- | :------ | :----------------- |
| GET    | `/advertising/packs`            | Get all active advertising packs          | Public  |                    |
| GET    | `/advertising/ads/display`      | Get ads for display                       | Public  |                    |
| POST   | `/advertising/webhooks/payment` | Webhook for payment confirmation          | Public? |                    |
| POST   | `/advertising/ads`              | Create a new advertisement (initiates payment) | User    |                    |
| GET    | `/advertising/ads/me`           | Get advertisements created by current user| User    |                    |
| GET    | `/advertising/ads/:advertisementId` | Get details of a specific advertisement | User    |                    |
| PUT    | `/advertising/ads/:advertisementId` | Update a specific advertisement         | User    |                    |

---

### 7. Notification Service (`notification-service`)

Manages sending notifications (email, SMS, push) and user notification history.

**Base Path (Conceptual):** `/api` (Routed via Gateway)

**Route Files:**

*   `notification.routes.ts`

**Endpoints:**

| Method | Path                             | Description                                  | Auth       | Middleware/Limiter |
| :----- | :------------------------------- | :------------------------------------------- | :--------- | :----------------- |
| GET    | `/notifications/me`              | Get current user's notifications           | User       |                    |
| GET    | `/notifications/me/stats`        | Get current user's notification stats        | User       |                    |
| POST   | `/notifications/otp`             | Send an OTP (internal request)               | Service    |                    |
| POST   | `/notifications/internal/create` | Create a notification (internal request)   | Service    |                    |
| POST   | `/notifications/internal/broadcast`| Broadcast a notification (internal request)| Service    |                    |
| POST   | `/notifications/custom`          | Send a custom notification (admin)           | Admin      |                    |
| POST   | `/notifications/templated`       | Send a templated notification (admin)        | Admin      |                    |
| POST   | `/notifications/follow-up`       | Send follow-up campaign notifications (admin)| Admin      |                    |

--- 