# Implementation Plan

- [x] 1. Set up WhatsApp Cloud API infrastructure and configuration

  - Create environment variable configuration for WhatsApp Cloud API credentials
  - Implement configuration validation and error handling for missing/invalid credentials
  - Add new dependencies (axios for HTTP requests, crypto for webhook validation)
  - Create types and interfaces for WhatsApp Cloud API requests and responses
  - _Requirements: 4.1, 4.2, 4.3_

- [-] 2. Implement core WhatsApp Cloud API client



  - [x] 2.1 Create WhatsApp Cloud API HTTP client with proper authentication


    - Implement HTTP client class with access token authentication
    - Add request/response interceptors for logging and error handling
    - Implement retry logic with exponential backoff for transient failures
    - _Requirements: 1.1, 1.2, 3.2_

  - [x] 2.2 Implement message sending functionality
    - Create methods for sending text messages via Cloud API
    - Implement message formatting and phone number validation
    - Add support for sending multiple messages with proper rate limiting
    - Write unit tests for message sending functionality
    - _Requirements: 2.1, 2.2, 1.1_

  - [x] 2.3 Implement file/media message support
    - Create methods for sending images, documents, and other media types
    - Implement media upload functionality to WhatsApp servers
    - Add support for captions and file metadata
    - Write unit tests for media message functionality
    - _Requirements: 2.1, 2.2_

- [x] 3. Create webhook handler for delivery status updates
  - [x] 3.1 Implement webhook endpoint and signature verification
    - Create Express route for WhatsApp webhook callbacks
    - Implement webhook signature verification for security
    - Add webhook verification endpoint for initial setup

    - Write unit tests for webhook validation
    - _Requirements: 5.1, 5.4_

  - [x] 3.2 Process webhook payloads and update message status

    - Parse webhook payloads for message status updates
    - Update notification records with delivery status (sent, delivered, read, failed)
    - Implement error handling for malformed webhook payloads
    - Add logging for webhook processing events
    - _Requirements: 5.2, 5.3_

- [x] 4. Refactor existing WhatsApp service to use Cloud API

  - [x] 4.1 Create feature flag system for gradual migration
    - Add environment variable to toggle between Bailey and Cloud API
    - Implement service factory pattern to switch implementations
    - Ensure backward compatibility with existing method signatures
    - _Requirements: 6.1, 6.2_

  - [x] 4.2 Replace Bailey implementation with Cloud API calls
    - Refactor sendTextMessage method to use Cloud API
    - Refactor sendMultipleTextMessages method with proper rate limiting
    - Replace sendFileMessage method with Cloud API media sending
    - Remove QR code generation and session management code
    - _Requirements: 1.1, 1.3, 2.1, 2.2_

  - [x] 4.3 Update connection status and health check methods
    - Replace Bailey connection status with Cloud API health checks
    - Remove QR code related methods (getLatestQr, streamWhatsAppQr)
    - Implement API token validation for health checks
    - Update getConnectionStatus to reflect Cloud API status
    - _Requirements: 1.2, 4.3_

- [ ] 5. Update notification service integration

  - [ ] 5.1 Extend notification model for WhatsApp message tracking
    - Add fields for WhatsApp message ID and delivery status
    - Create database migration for new notification fields
    - Update notification repository methods to handle new fields
    - _Requirements: 5.1, 5.2_

  - [ ] 5.2 Update notification service WhatsApp sending logic
    - Modify sendWhatsappNotification to use new Cloud API service
    - Implement proper error handling and fallback mechanisms
    - Update message status tracking with webhook data
    - Add support for message delivery confirmation
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 5.2, 5.3_

- [ ] 6. Update API controllers and routes
  - [ ] 6.1 Refactor WhatsApp controller endpoints
    - Remove QR code related endpoints (getWhatsAppQr, streamWhatsAppQr)
    - Update getWhatsAppStatus endpoint for Cloud API status
    - Remove logout and forceReconnect endpoints (not needed for Cloud API)
    - Add new webhook endpoint for status updates
    - _Requirements: 1.3, 6.1, 6.2_

  - [ ] 6.2 Add webhook routes and middleware
    - Create POST route for WhatsApp webhook callbacks
    - Add GET route for webhook verification during setup
    - Implement middleware for webhook signature validation
    - Add error handling and logging for webhook requests
    - _Requirements: 5.1, 5.4_

- [ ] 7. Implement comprehensive error handling and logging
  - [ ] 7.1 Add Cloud API specific error handling
    - Create error classes for different WhatsApp API error types
    - Implement retry logic for rate limiting and temporary failures
    - Add proper error logging with correlation IDs
    - Create error mapping for user-friendly error messages
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ] 7.2 Implement fallback mechanisms for failed messages
    - Add automatic fallback to SMS/Email for critical OTP messages
    - Implement message queuing for temporary API failures
    - Add admin notifications for extended API outages
    - Create monitoring alerts for high error rates
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 8. Update package dependencies and remove Bailey
  - [ ] 8.1 Add new dependencies and remove Bailey packages
    - Add axios for HTTP requests and crypto for webhook validation
    - Remove @whiskeysockets/baileys and related dependencies
    - Remove qrcode and qrcode-terminal packages
    - Update package.json and install new dependencies
    - _Requirements: 1.3, 1.4_

  - [ ] 8.2 Clean up Bailey-related files and authentication
    - Remove whatsapp_auth directory and session files
    - Clean up Bailey-related imports and type definitions
    - Remove QR code generation utilities
    - Update TypeScript configuration if needed
    - _Requirements: 1.3, 1.4_

- [ ] 9. Create comprehensive tests for Cloud API implementation
  - [ ] 9.1 Write unit tests for WhatsApp Cloud API service
    - Test message sending functionality with mocked API responses
    - Test error handling for various API error scenarios
    - Test webhook payload processing and signature verification
    - Test rate limiting and retry logic
    - _Requirements: 1.1, 3.1, 3.2, 5.4_

  - [ ] 9.2 Write integration tests for end-to-end functionality
    - Test complete message sending flow from notification service
    - Test webhook delivery status updates end-to-end
    - Test fallback mechanisms when API is unavailable
    - Test backward compatibility with existing API contracts
    - _Requirements: 2.1, 2.2, 5.2, 5.3, 6.1, 6.2_

- [ ] 10. Update configuration and deployment
  - [ ] 10.1 Update environment configuration and documentation
    - Add new WhatsApp Cloud API environment variables to .env files
    - Update Docker configuration with new environment variables
    - Create migration guide for updating production configuration
    - Update API documentation to reflect changes
    - _Requirements: 4.1, 4.2, 6.3, 6.4_

  - [ ] 10.2 Update deployment scripts and monitoring
    - Update health check endpoints to validate Cloud API connectivity
    - Add monitoring for WhatsApp API response times and error rates
    - Update logging configuration for new service structure
    - Create alerts for webhook processing failures
    - _Requirements: 3.3, 4.3_