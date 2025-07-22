import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import WhatsAppCloudService from '../services/whatsapp-cloud.service';
import * as httpClient from '../utils/http-client';
import { MEDIA_CONFIG } from '../constants/whatsapp-cloud-api.constants';

// Mock dependencies
jest.mock('../utils/http-client');
jest.mock('../utils/logger', () => ({
    getLogger: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    }))
}));
jest.mock('../config', () => ({
    whatsapp: {
        accessToken: 'test-token',
        phoneNumberId: '123456789',
        businessAccountId: '987654321',
        webhookVerifyToken: 'test-webhook-token',
        apiVersion: 'v18.0',
        apiBaseUrl: 'https://graph.facebook.com'
    }
}));

// Mock form-data
jest.mock('form-data', () => {
    return jest.fn().mockImplementation(() => {
        return {
            append: jest.fn(),
            getHeaders: jest.fn().mockReturnValue({ 'content-type': 'multipart/form-data' })
        };
    });
});

describe('WhatsAppCloudService', () => {
    let mockHttpClient: any;
    let mockResponse: any;
    let mockMediaUploadResponse: any;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Mock HTTP client
        mockHttpClient = {
            get: jest.fn(),
            post: jest.fn()
        };
        (httpClient.createWhatsAppHttpClient as jest.Mock).mockReturnValue(mockHttpClient);

        // Mock withRetry to just call the function
        (httpClient.withRetry as jest.Mock).mockImplementation((fn: () => Promise<any>) => fn());

        // Mock successful message response
        mockResponse = {
            data: {
                messaging_product: 'whatsapp',
                contacts: [{ input: '+1234567890', wa_id: '1234567890' }],
                messages: [{ id: 'wamid.123456789' }]
            }
        };

        // Mock successful media upload response
        mockMediaUploadResponse = {
            data: {
                id: 'media-id-123456'
            }
        };
    });

    afterEach(() => {
        // Reset service state
        WhatsAppCloudService.emit('error', new Error('Test reset'));
    });

    describe('sendTextMessage', () => {
        it('should send a text message successfully', async () => {
            // Mock successful API response
            mockHttpClient.post.mockResolvedValue(mockResponse);

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Call the method
            const result = await WhatsAppCloudService.sendTextMessage({
                phoneNumber: '+1234567890',
                message: 'Test message'
            });

            // Verify result
            expect(result).toBe(true);

            // Verify HTTP client was called correctly
            expect(mockHttpClient.post).toHaveBeenCalledWith(
                '/123456789/messages',
                expect.objectContaining({
                    messaging_product: 'whatsapp',
                    to: '1234567890',
                    type: 'text',
                    text: expect.objectContaining({
                        body: 'Test message'
                    })
                })
            );
        });

        it('should handle invalid phone number', async () => {
            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Call with invalid phone number
            const result = await WhatsAppCloudService.sendTextMessage({
                phoneNumber: 'invalid',
                message: 'Test message'
            });

            // Verify result
            expect(result).toBe(false);

            // Verify HTTP client was not called
            expect(mockHttpClient.post).not.toHaveBeenCalled();
        });

        it('should handle API error', async () => {
            // Mock API error
            mockHttpClient.post.mockRejectedValue(new Error('API Error'));

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Call the method
            const result = await WhatsAppCloudService.sendTextMessage({
                phoneNumber: '+1234567890',
                message: 'Test message'
            });

            // Verify result
            expect(result).toBe(false);
        });

        it('should handle service not ready', async () => {
            // Service not initialized

            // Call the method
            const result = await WhatsAppCloudService.sendTextMessage({
                phoneNumber: '+1234567890',
                message: 'Test message'
            });

            // Verify result
            expect(result).toBe(false);

            // Verify HTTP client was not called
            expect(mockHttpClient.post).not.toHaveBeenCalled();
        });
    });

    describe('sendMultipleTextMessages', () => {
        it('should send multiple messages successfully', async () => {
            // Mock successful API responses
            mockHttpClient.post.mockResolvedValue(mockResponse);

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Call the method
            const result = await WhatsAppCloudService.sendMultipleTextMessages({
                phoneNumber: '+1234567890',
                messages: ['Message 1', 'Message 2', 'Message 3']
            });

            // Verify result
            expect(result).toBe(true);

            // Verify HTTP client was called correct number of times
            expect(mockHttpClient.post).toHaveBeenCalledTimes(3);
        });

        it('should handle empty messages array', async () => {
            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Call with empty messages
            const result = await WhatsAppCloudService.sendMultipleTextMessages({
                phoneNumber: '+1234567890',
                messages: []
            });

            // Verify result
            expect(result).toBe(false);

            // Verify HTTP client was not called
            expect(mockHttpClient.post).not.toHaveBeenCalled();
        });

        it('should handle invalid phone number', async () => {
            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Call with invalid phone number
            const result = await WhatsAppCloudService.sendMultipleTextMessages({
                phoneNumber: 'invalid',
                messages: ['Test message']
            });

            // Verify result
            expect(result).toBe(false);

            // Verify HTTP client was not called
            expect(mockHttpClient.post).not.toHaveBeenCalled();
        });

        it('should handle partial failures', async () => {
            // Mock mixed success/failure responses
            mockHttpClient.post
                .mockResolvedValueOnce(mockResponse)
                .mockRejectedValueOnce(new Error('API Error'))
                .mockResolvedValueOnce(mockResponse);

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Call the method
            const result = await WhatsAppCloudService.sendMultipleTextMessages({
                phoneNumber: '+1234567890',
                messages: ['Message 1', 'Message 2', 'Message 3']
            });

            // Verify result - should be true if at least one message was sent
            expect(result).toBe(true);

            // Verify HTTP client was called correct number of times
            expect(mockHttpClient.post).toHaveBeenCalledTimes(3);
        });

        it('should handle all failures', async () => {
            // Mock all failures
            mockHttpClient.post.mockRejectedValue(new Error('API Error'));

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Call the method
            const result = await WhatsAppCloudService.sendMultipleTextMessages({
                phoneNumber: '+1234567890',
                messages: ['Message 1', 'Message 2']
            });

            // Verify result
            expect(result).toBe(false);

            // Verify HTTP client was called correct number of times
            expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
        });

        it('should filter out empty messages', async () => {
            // Mock successful API responses
            mockHttpClient.post.mockResolvedValue(mockResponse);

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Call the method with some empty messages
            const result = await WhatsAppCloudService.sendMultipleTextMessages({
                phoneNumber: '+1234567890',
                messages: ['Message 1', '', null as any, undefined as any, 'Message 2']
            });

            // Verify result
            expect(result).toBe(true);

            // Verify HTTP client was called only for non-empty messages
            expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
        });
    });

    describe('sendFileMessage', () => {
        it('should send an image message successfully', async () => {
            // Mock successful API responses
            mockHttpClient.post
                .mockResolvedValueOnce(mockMediaUploadResponse) // For media upload
                .mockResolvedValueOnce(mockResponse); // For message sending

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Create a test buffer
            const buffer = Buffer.from('test image data');
            const mimetype = 'image/jpeg';

            // Call the method
            const result = await WhatsAppCloudService.sendFileMessage({
                phoneNumber: '+1234567890',
                buffer,
                mimetype,
                caption: 'Test image caption'
            });

            // Verify result
            expect(result).toBe(true);

            // Verify HTTP client was called for media upload
            expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
            
            // Verify the second call was for sending the message with the media ID
            expect(mockHttpClient.post.mock.calls[1][0]).toBe('/123456789/messages');
            expect(mockHttpClient.post.mock.calls[1][1]).toEqual(expect.objectContaining({
                messaging_product: 'whatsapp',
                to: '1234567890',
                type: 'image',
                image: expect.objectContaining({
                    id: 'media-id-123456',
                    caption: 'Test image caption'
                })
            }));
        });

        it('should send a document message successfully', async () => {
            // Mock successful API responses
            mockHttpClient.post
                .mockResolvedValueOnce(mockMediaUploadResponse) // For media upload
                .mockResolvedValueOnce(mockResponse); // For message sending

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Create a test buffer
            const buffer = Buffer.from('test document data');
            const mimetype = 'application/pdf';
            const fileName = 'test-document.pdf';

            // Call the method
            const result = await WhatsAppCloudService.sendFileMessage({
                phoneNumber: '+1234567890',
                buffer,
                mimetype,
                fileName,
                caption: 'Test document caption'
            });

            // Verify result
            expect(result).toBe(true);

            // Verify HTTP client was called for media upload
            expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
            
            // Verify the second call was for sending the message with the media ID
            expect(mockHttpClient.post.mock.calls[1][0]).toBe('/123456789/messages');
            expect(mockHttpClient.post.mock.calls[1][1]).toEqual(expect.objectContaining({
                messaging_product: 'whatsapp',
                to: '1234567890',
                type: 'document',
                document: expect.objectContaining({
                    id: 'media-id-123456',
                    filename: 'test-document.pdf',
                    caption: 'Test document caption'
                })
            }));
        });

        it('should send a video message successfully', async () => {
            // Mock successful API responses
            mockHttpClient.post
                .mockResolvedValueOnce(mockMediaUploadResponse) // For media upload
                .mockResolvedValueOnce(mockResponse); // For message sending

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Create a test buffer
            const buffer = Buffer.from('test video data');
            const mimetype = 'video/mp4';

            // Call the method
            const result = await WhatsAppCloudService.sendFileMessage({
                phoneNumber: '+1234567890',
                buffer,
                mimetype,
                caption: 'Test video caption'
            });

            // Verify result
            expect(result).toBe(true);

            // Verify HTTP client was called for media upload
            expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
            
            // Verify the second call was for sending the message with the media ID
            expect(mockHttpClient.post.mock.calls[1][0]).toBe('/123456789/messages');
            expect(mockHttpClient.post.mock.calls[1][1]).toEqual(expect.objectContaining({
                messaging_product: 'whatsapp',
                to: '1234567890',
                type: 'video',
                video: expect.objectContaining({
                    id: 'media-id-123456',
                    caption: 'Test video caption'
                })
            }));
        });

        it('should send an audio message successfully', async () => {
            // Mock successful API responses
            mockHttpClient.post
                .mockResolvedValueOnce(mockMediaUploadResponse) // For media upload
                .mockResolvedValueOnce(mockResponse); // For message sending

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Create a test buffer
            const buffer = Buffer.from('test audio data');
            const mimetype = 'audio/mp3';

            // Call the method
            const result = await WhatsAppCloudService.sendFileMessage({
                phoneNumber: '+1234567890',
                buffer,
                mimetype
            });

            // Verify result
            expect(result).toBe(true);

            // Verify HTTP client was called for media upload
            expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
            
            // Verify the second call was for sending the message with the media ID
            expect(mockHttpClient.post.mock.calls[1][0]).toBe('/123456789/messages');
            expect(mockHttpClient.post.mock.calls[1][1]).toEqual(expect.objectContaining({
                messaging_product: 'whatsapp',
                to: '1234567890',
                type: 'audio',
                audio: expect.objectContaining({
                    id: 'media-id-123456'
                })
            }));
        });

        it('should handle media upload failure', async () => {
            // Mock API error for media upload
            mockHttpClient.post.mockRejectedValueOnce(new Error('Media upload failed'));

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Create a test buffer
            const buffer = Buffer.from('test image data');
            const mimetype = 'image/jpeg';

            // Call the method
            const result = await WhatsAppCloudService.sendFileMessage({
                phoneNumber: '+1234567890',
                buffer,
                mimetype,
                caption: 'Test image caption'
            });

            // Verify result
            expect(result).toBe(false);

            // Verify HTTP client was called only once (for media upload)
            expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
        });

        it('should handle message sending failure after successful upload', async () => {
            // Mock successful media upload but failed message sending
            mockHttpClient.post
                .mockResolvedValueOnce(mockMediaUploadResponse) // For media upload
                .mockRejectedValueOnce(new Error('Message sending failed')); // For message sending

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Create a test buffer
            const buffer = Buffer.from('test image data');
            const mimetype = 'image/jpeg';

            // Call the method
            const result = await WhatsAppCloudService.sendFileMessage({
                phoneNumber: '+1234567890',
                buffer,
                mimetype,
                caption: 'Test image caption'
            });

            // Verify result
            expect(result).toBe(false);

            // Verify HTTP client was called twice
            expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
        });

        it('should reject oversized files', async () => {
            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Create a buffer that exceeds the image size limit
            const oversizedBuffer = Buffer.alloc(MEDIA_CONFIG.MAX_FILE_SIZE.IMAGE + 1);
            const mimetype = 'image/jpeg';

            // Call the method
            const result = await WhatsAppCloudService.sendFileMessage({
                phoneNumber: '+1234567890',
                buffer: oversizedBuffer,
                mimetype
            });

            // Verify result
            expect(result).toBe(false);

            // Verify HTTP client was not called
            expect(mockHttpClient.post).not.toHaveBeenCalled();
        });

        it('should reject unsupported file types', async () => {
            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Create a buffer with unsupported mimetype
            const buffer = Buffer.from('test data');
            const mimetype = 'application/unsupported-type';

            // Call the method
            const result = await WhatsAppCloudService.sendFileMessage({
                phoneNumber: '+1234567890',
                buffer,
                mimetype
            });

            // Verify result
            expect(result).toBe(false);

            // Verify HTTP client was not called
            expect(mockHttpClient.post).not.toHaveBeenCalled();
        });

        it('should handle invalid phone number', async () => {
            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Create a test buffer
            const buffer = Buffer.from('test image data');
            const mimetype = 'image/jpeg';

            // Call with invalid phone number
            const result = await WhatsAppCloudService.sendFileMessage({
                phoneNumber: 'invalid',
                buffer,
                mimetype
            });

            // Verify result
            expect(result).toBe(false);

            // Verify HTTP client was not called
            expect(mockHttpClient.post).not.toHaveBeenCalled();
        });

        it('should handle empty buffer', async () => {
            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Call with empty buffer
            const result = await WhatsAppCloudService.sendFileMessage({
                phoneNumber: '+1234567890',
                buffer: Buffer.alloc(0),
                mimetype: 'image/jpeg'
            });

            // Verify result
            expect(result).toBe(false);

            // Verify HTTP client was not called
            expect(mockHttpClient.post).not.toHaveBeenCalled();
        });

        it('should handle service not ready', async () => {
            // Service not initialized

            // Create a test buffer
            const buffer = Buffer.from('test image data');
            const mimetype = 'image/jpeg';

            // Call the method
            const result = await WhatsAppCloudService.sendFileMessage({
                phoneNumber: '+1234567890',
                buffer,
                mimetype
            });

            // Verify result
            expect(result).toBe(false);

            // Verify HTTP client was not called
            expect(mockHttpClient.post).not.toHaveBeenCalled();
        });
    });

    describe('phone number validation', () => {
        it('should accept valid phone numbers', async () => {
            // Mock successful API response
            mockHttpClient.post.mockResolvedValue(mockResponse);

            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Test various valid phone number formats
            const validPhoneNumbers = [
                '+1234567890',
                '1234567890',
                '+12345678901234',
                '(123) 456-7890',
                '123-456-7890'
            ];

            for (const phoneNumber of validPhoneNumbers) {
                const result = await WhatsAppCloudService.sendTextMessage({
                    phoneNumber,
                    message: 'Test message'
                });

                expect(result).toBe(true);
            }
        });

        it('should reject invalid phone numbers', async () => {
            // Initialize service
            WhatsAppCloudService.emit('connected');

            // Test various invalid phone number formats
            const invalidPhoneNumbers = [
                '',
                'abc',
                '123',
                '+',
                '+0123456789', // Starting with 0 after +
                '+12345678901234567' // Too long
            ];

            for (const phoneNumber of invalidPhoneNumbers) {
                const result = await WhatsAppCloudService.sendTextMessage({
                    phoneNumber,
                    message: 'Test message'
                });

                expect(result).toBe(false);
            }

            // Verify HTTP client was not called
            expect(mockHttpClient.post).not.toHaveBeenCalled();
        });
    });
});