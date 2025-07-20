import { Request, Response } from 'express';
import whatsappService from '../../services/whatsapp.service';
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

        await whatsappService.sendTransactionNotification(transactionData);

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
    const { qr, timestamp } = whatsappService.getLatestQr();
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
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });
    // Send the latest QR immediately if available
    const { qr, timestamp } = whatsappService.getLatestQr();
    if (qr) {
        res.write(`event: qr\ndata: ${JSON.stringify({ qr, timestamp })}\n\n`);
    }
    // Listen for new QR codes
    const onQr = (newQr: string) => {
        res.write(`event: qr\ndata: ${JSON.stringify({ qr: newQr, timestamp: Date.now() })}\n\n`);
    };
    whatsappService.on('qr', onQr);
    // Clean up on client disconnect
    req.on('close', () => {
        whatsappService.off('qr', onQr);
    });
};

export const getWhatsAppStatus = (req: Request, res: Response) => {
    try {
        const status = whatsappService.getConnectionStatus();
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
        const result = await whatsappService.logout();
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
        const result = await whatsappService.forceReconnect();
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