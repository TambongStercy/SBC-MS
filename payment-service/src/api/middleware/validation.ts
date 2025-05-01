import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger';

const log = logger.getLogger('ValidationMiddleware');

export const validatePaymentIntent = (req: Request, res: Response, next: NextFunction) => {
    const { userId, amount, currency, paymentType } = req.body;

    // Check for required fields
    const missingFields = [];
    if (!userId) missingFields.push('userId');
    if (amount === undefined || amount === null) missingFields.push('amount');
    if (!currency) missingFields.push('currency');
    if (!paymentType) missingFields.push('paymentType');

    if (missingFields.length > 0) {
        log.warn('Validation failed for create payment intent: Missing fields', { missingFields });
        return res.status(400).json({
            success: false,
            message: `Missing required fields: ${missingFields.join(', ')}`
        });
    }

    // Optional: Add more specific validation (e.g., amount > 0, currency is valid format)
    if (typeof amount !== 'number' || amount <= 0) {
        log.warn('Validation failed for create payment intent: Invalid amount', { amount });
        return res.status(400).json({
            success: false,
            message: 'Invalid amount provided. Must be a positive number.'
        });
    }

    if (typeof currency !== 'string' || currency.length < 3) { // Basic currency format check
        log.warn('Validation failed for create payment intent: Invalid currency', { currency });
        return res.status(400).json({
            success: false,
            message: 'Invalid currency format provided.'
        });
    }

    if (typeof paymentType !== 'string' || paymentType.length === 0) {
        log.warn('Validation failed for create payment intent: Invalid paymentType', { paymentType });
        return res.status(400).json({
            success: false,
            message: 'Invalid paymentType provided.'
        });
    }

    next();
};

export const validatePaymentDetails = (req: Request, res: Response, next: NextFunction) => {
    const { phoneNumber, countryCode, paymentCurrency } = req.body;
    const { sessionId } = req.params;

    if (!sessionId) {
        return res.status(400).json({
            success: false,
            message: 'Missing sessionId parameter'
        });
    }

    // Always require countryCode and paymentCurrency
    if (!countryCode || !paymentCurrency) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: countryCode, paymentCurrency'
        });
    }

    // Validate paymentCurrency format/value
    const validCurrencies = ['XOF', 'XAF', 'KES', 'CDF', 'GNF']; // Add other supported currencies
    if (typeof paymentCurrency !== 'string' || !validCurrencies.includes(paymentCurrency)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid or unsupported payment currency'
        });
    }

    // Validate country code format/value
    // Ensure this list matches the countries available in the frontend dropdown
    const validCountries = ['BJ', 'BF', 'CI', 'SN', 'CG', 'TG', 'CM', 'GA', 'CD', 'KE', 'GN', 'ML', 'NE'];
    if (typeof countryCode !== 'string' || !validCountries.includes(countryCode)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid or unsupported country code'
        });
    }

    // Validate phone number format ONLY IF it is provided
    if (phoneNumber && !/^[0-9]{8,}$/.test(String(phoneNumber).replace(/\D/g, ''))) {
        return res.status(400).json({
            success: false,
            message: 'Invalid phone number format'
        });
    }

    // Mandatory phone number check is moved to the service layer

    next();
}; 