import { Request, Response } from 'express';
import whatsappService from '../../../src/services/whatsapp.service';
import logger from '../../../src/utils/logger';

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