import * as amqp from 'amqplib';
// Explicitly import types
import type { Connection, Channel, ConsumeMessage } from 'amqplib';
import config from '../config';
import logger from '../utils/logger';
import { notificationService } from '../services/notification.service'; // Assuming service export

const log = logger.getLogger('BroadcastWorker');
const queueName = 'broadcast_jobs_queue'; // Same queue name used for publishing

// Store connection and channel globally within the worker scope to manage closing on shutdown
let rabbitConnection: Connection | null = null;
let rabbitChannel: Channel | null = null;

async function consumeBroadcastNotifications() {
    log.info('Attempting to connect to RabbitMQ to consume broadcast jobs...');
    // Use the global variables
    // let connection: Connection | null = null; 
    // let channel: Channel | null = null;

    try {
        // Validate config
        if (!config.rabbitMQ || !config.rabbitMQ.url) {
            throw new Error('RabbitMQ URL not configured.');
        }

        // Use global connection variable
        // Cast through unknown to bypass potential type definition issues
        rabbitConnection = await amqp.connect(config.rabbitMQ.url) as unknown as Connection;
        log.info('Successfully connected to RabbitMQ.');

        // Add null check for connection before attaching listeners
        if (rabbitConnection) {
            rabbitConnection.on('error', (err) => {
                log.error('RabbitMQ connection error:', err);
                rabbitConnection = null; // Reset connection on error
                rabbitChannel = null;
                // Implement reconnection logic if needed
                log.info('Retrying connection in 5 seconds due to error...');
                setTimeout(consumeBroadcastNotifications, 5000); // Retry connection after 5s
            });

            rabbitConnection.on('close', () => {
                // Avoid logging during intentional shutdown
                // Check if connection still exists before logging/reconnecting
                if (rabbitConnection) {
                    log.warn('RabbitMQ connection closed unexpectedly. Attempting to reconnect...');
                    rabbitConnection = null; // Reset connection on close
                    rabbitChannel = null;
                    // Implement reconnection logic if needed
                    log.info('Retrying connection in 5 seconds due to unexpected close...');
                    setTimeout(consumeBroadcastNotifications, 5000); // Retry connection after 5s
                }
            });

            // Use global channel variable - Ensure connection exists before creating channel
            // @ts-ignore - Suppress incorrect type error from @types/amqplib
            rabbitChannel = await rabbitConnection.createChannel();
            log.info('RabbitMQ channel created.');

            // Add null check for channel before setup
            if (rabbitChannel) {
                await rabbitChannel.assertQueue(queueName, { durable: true });
                log.info(`Worker asserted queue '${queueName}' successfully.`);

                await rabbitChannel.prefetch(1);
                log.info(`[*] Waiting for messages in ${queueName}. To exit press CTRL+C`);

                // Consume messages - Check channel exists
                rabbitChannel.consume(queueName, async (msg: ConsumeMessage | null) => {
                    // Moved channel check inside callback
                    if (msg !== null && rabbitChannel) {
                        log.info(`[x] Received broadcast job with content length: ${msg.content.length}`);
                        let payload: any;
                        try {
                            payload = JSON.parse(msg.content.toString());
                            log.debug('Parsed payload:', payload);

                            // -------------
                            // TODO: Implement the actual broadcast logic here
                            log.info(`Processing broadcast job: Type=${payload.type}, Title=${payload.data?.title}`);
                            // await processBroadcastJob(payload);
                            // -------------

                            log.info(`[x] Finished processing job.`);
                            // Acknowledge message using the current channel reference
                            rabbitChannel.ack(msg);
                        } catch (error: any) {
                            log.error('Error processing broadcast job or parsing message:', {
                                error: error.message,
                                stack: error.stack,
                                rawContent: msg.content.toString().substring(0, 200) + '...'
                            });
                            // Reject message using the current channel reference
                            rabbitChannel.nack(msg, false, false);
                        }
                    } else if (!rabbitChannel) {
                        log.warn('Received message but channel is closed. Cannot process or ack/nack.');
                        // Potentially requeue if possible or log for investigation
                    }
                }, {
                    noAck: false // Ensure messages are acknowledged
                });
            } else {
                log.error('Failed to create RabbitMQ channel. Cannot consume messages.');
                // Handle channel creation failure (e.g., close connection and retry)
                if (rabbitConnection) {
                    // @ts-ignore - Suppress incorrect type error from @types/amqplib
                    await rabbitConnection.close(); // Close the connection if channel creation failed
                    rabbitConnection = null;
                }
                throw new Error('Failed to create RabbitMQ channel');
            }
        } else {
            // This case should ideally not be reached if connect throws on failure
            log.error('RabbitMQ connection is null after connect call. Retrying...');
            throw new Error('RabbitMQ connection failed silently');
        }

    } catch (error: any) {
        log.error('Failed to start RabbitMQ consumer:', { error: error.message, stack: error.stack });
        // Clean up potentially partially opened resources
        if (rabbitChannel) {
            try { await rabbitChannel.close(); } catch (e) { log.error('Error closing channel on startup failure', e); }
            rabbitChannel = null;
        }
        if (rabbitConnection) { // Check connection before closing
            try {
                // @ts-ignore - Suppress incorrect type error from @types/amqplib
                await rabbitConnection.close();
            } catch (e) { log.error('Error closing connection on startup failure', e); }
            rabbitConnection = null;
        }
        log.info('Retrying connection in 10 seconds...');
        setTimeout(consumeBroadcastNotifications, 10000);
    }
}

// Function to gracefully close connections
async function closeConnections() {
    log.info('Closing RabbitMQ channel and connection...');
    let closed = false;
    if (rabbitChannel) {
        try {
            await rabbitChannel.close();
            log.info('RabbitMQ channel closed.');
            rabbitChannel = null;
            closed = true;
        } catch (err) {
            log.error('Error closing RabbitMQ channel during shutdown:', err);
        }
    }
    if (rabbitConnection) {
        try {
            // @ts-ignore - Suppress incorrect type error from @types/amqplib
            await rabbitConnection.close();
            log.info('RabbitMQ connection closed.');
            rabbitConnection = null; // Mark as closed
            closed = true;
        } catch (err) {
            log.error('Error closing RabbitMQ connection during shutdown:', err);
        }
    }
    if (closed) {
        log.info('RabbitMQ resources closed.');
    } else {
        log.info('No active RabbitMQ resources to close.');
    }
}

// Start the consumer
consumeBroadcastNotifications();

// Graceful shutdown handling
process.once('SIGINT', async () => {
    log.info('SIGINT received, initiating graceful shutdown...');
    await closeConnections();
    process.exit(0);
});

process.once('SIGTERM', async () => {
    log.info('SIGTERM received, initiating graceful shutdown...');
    await closeConnections();
    process.exit(0);
});

// Placeholder for the actual broadcast job processing function
// async function processBroadcastJob(payload: any) { ... } 