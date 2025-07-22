import { Request, Response } from 'express';
import whatsappServiceFactory from '../../services/whatsapp-service-factory';
import config from '../../config';
import logger from '../../utils/logger';

export const testWhatsAppNotification = async (req: Request, res: Response) => {
    try {
        const transactionData = req.body;

        // Validate required fields
        const requiredFields = ['phoneNumber', 'name', 'transactionType', 'transactionId', 'amount', 'currency', 'date'];
        const missingFields = requiredFields.filter(field => !transactionData[field]);

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missingFields.join(', ')}`
            });
        }

        await whatsappServiceFactory.getService().sendTransactionNotification(transactionData);

        res.status(200).json({
            success: true,
            message: 'WhatsApp notification sent successfully'
        });
    } catch (error) {
        logger.error('Error in testWhatsAppNotification:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send WhatsApp notification',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export const getWhatsAppQr = (req: Request, res: Response) => {
    // QR code functionality is only available for Bailey implementation
    if (config.whatsapp.enableCloudApi) {
        return res.status(404).json({
            success: false,
            message: 'QR code is not available when using WhatsApp Cloud API. Please use the Meta Business Manager to configure your WhatsApp Business account.'
        });
    }

    const service = whatsappServiceFactory.getService() as any;

    // Check if the service has the getLatestQr method (Bailey-specific)
    if (!service.getLatestQr) {
        return res.status(404).json({ success: false, message: 'QR code functionality not available' });
    }

    const { qr, timestamp } = service.getLatestQr();
    if (!qr) {
        return res.status(404).json({ success: false, message: 'No QR code available' });
    }

    // Return as image/png
    const base64 = qr.replace(/^data:image\/png;base64,/, '');
    const img = Buffer.from(base64, 'base64');
    res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': img.length,
        'Cache-Control': 'no-cache',
        'X-QR-Timestamp': timestamp.toString(),
    });
    res.end(img);
};

export const streamWhatsAppQr = (req: Request, res: Response) => {
    // QR code functionality is only available for Bailey implementation
    if (config.whatsapp.enableCloudApi) {
        return res.status(404).json({
            success: false,
            message: 'QR code streaming is not available when using WhatsApp Cloud API. Please use the Meta Business Manager to configure your WhatsApp Business account.'
        });
    }

    const service = whatsappServiceFactory.getService() as any;

    // Check if the service has the required methods (Bailey-specific)
    if (!service.getLatestQr || !service.on || !service.off) {
        return res.status(404).json({ success: false, message: 'QR code streaming functionality not available' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });

    // Send the latest QR immediately if available
    const { qr, timestamp } = service.getLatestQr();
    if (qr) {
        res.write(`event: qr\ndata: ${JSON.stringify({ qr, timestamp })}\n\n`);
    }

    // Listen for new QR codes
    const onQr = (newQr: string) => {
        res.write(`event: qr\ndata: ${JSON.stringify({ qr: newQr, timestamp: Date.now() })}\n\n`);
    };
    service.on('qr', onQr);

    // Clean up on client disconnect
    req.on('close', () => {
        service.off('qr', onQr);
    });
};

export const getWhatsAppStatus = (req: Request, res: Response) => {
    try {
        const status = whatsappServiceFactory.getService().getConnectionStatus();
        res.status(200).json({
            success: true,
            data: status
        });
    } catch (error) {
        logger.error('Error getting WhatsApp status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get WhatsApp status',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export const logoutWhatsApp = async (req: Request, res: Response) => {
    try {
        // Logout functionality is only available for Bailey implementation
        if (config.whatsapp.enableCloudApi) {
            return res.status(400).json({
                success: false,
                message: 'Logout is not applicable for WhatsApp Cloud API. The service uses persistent access tokens managed through Meta Business Manager.'
            });
        }

        const service = whatsappServiceFactory.getService() as any;

        // Check if the service has the logout method (Bailey-specific)
        if (!service.logout) {
            return res.status(400).json({
                success: false,
                message: 'Logout functionality not available for current WhatsApp implementation'
            });
        }

        const result = await service.logout();
        if (result.success) {
            res.status(200).json({
                success: true,
                message: 'WhatsApp logged out successfully'
            });
        } else {
            res.status(400).json({
                success: false,
                message: result.message || 'Failed to logout WhatsApp'
            });
        }
    } catch (error) {
        logger.error('Error logging out WhatsApp:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to logout WhatsApp',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export const forceReconnectWhatsApp = async (req: Request, res: Response) => {
    try {
        // Force reconnect functionality is only available for Bailey implementation
        if (config.whatsapp.enableCloudApi) {
            return res.status(400).json({
                success: false,
                message: 'Force reconnect is not applicable for WhatsApp Cloud API. The service maintains persistent connections through Meta\'s infrastructure.'
            });
        }

        const service = whatsappServiceFactory.getService() as any;

        // Check if the service has the forceReconnect method (Bailey-specific)
        if (!service.forceReconnect) {
            return res.status(400).json({
                success: false,
                message: 'Force reconnect functionality not available for current WhatsApp implementation'
            });
        }

        const result = await service.forceReconnect();
        if (result.success) {
            res.status(200).json({
                success: true,
                message: result.message || 'WhatsApp reconnection initiated'
            });
        } else {
            res.status(400).json({
                success: false,
                message: result.message || 'Failed to force reconnect WhatsApp'
            });
        }
    } catch (error) {
        logger.error('Error force reconnecting WhatsApp:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to force reconnect WhatsApp',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}; 