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

    // Always require paymentCurrency
    if (!paymentCurrency) {
        return res.status(400).json({
            success: false,
            message: 'Missing required field: paymentCurrency'
        });
    }

    // Validate paymentCurrency format/value
    const validFiatCurrencies = ['XOF', 'XAF', 'KES', 'CDF', 'GNF']; // Fiat currencies
    const validCryptoCurrencies = [
        'BTC', 'LTC', 'XRP', 'TRX',
        'USDTSOL', 'USDTBSC', 'BNBBSC'
    ]; // Crypto currencies
    const validCurrencies = [...validFiatCurrencies, ...validCryptoCurrencies];

    if (typeof paymentCurrency !== 'string' || !validCurrencies.includes(paymentCurrency)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid or unsupported payment currency'
        });
    }

    // Check if this is a crypto payment
    const isCryptoPayment = validCryptoCurrencies.includes(paymentCurrency);

    // For crypto payments, country code is not required
    if (isCryptoPayment) {
        // Crypto payments don't need country code or phone number
        // Skip country and phone validation for crypto payments
        next();
        return;
    }

    // For fiat payments, countryCode is required
    if (!countryCode) {
        return res.status(400).json({
            success: false,
            message: 'Missing required field: countryCode (required for fiat payments)'
        });
    }

    // Validate country code format/value for fiat payments
    // Removed "CRYPTO" from valid countries as it's not a real country
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

/**
 * Validate user withdrawal request
 */
export const validateWithdrawal = (req: Request, res: Response, next: NextFunction) => {
    const { amount, withdrawalType } = req.body;

    if (!amount) {
        log.warn('Validation failed for user withdrawal: Missing amount');
        return res.status(400).json({
            success: false,
            message: 'Amount is required'
        });
    }

    if (!withdrawalType) {
        log.warn('Validation failed for user withdrawal: Missing withdrawalType');
        return res.status(400).json({
            success: false,
            message: 'Withdrawal type is required. Use "mobile_money" or "crypto".'
        });
    }

    if (!['mobile_money', 'crypto'].includes(withdrawalType)) {
        log.warn('Validation failed for user withdrawal: Invalid withdrawalType', { withdrawalType });
        return res.status(400).json({
            success: false,
            message: 'Invalid withdrawal type. Use "mobile_money" or "crypto".'
        });
    }

    if (typeof amount !== 'number' || amount <= 0) {
        log.warn('Validation failed for user withdrawal: Invalid amount', { amount });
        return res.status(400).json({
            success: false,
            message: 'Amount must be a positive number'
        });
    }

    // Apply different minimum amounts based on withdrawal type
    if (withdrawalType === 'mobile_money') {
        // Mobile money minimum: 500 XAF
        if (amount < 500) {
            return res.status(400).json({
                success: false,
                message: 'Minimum mobile money withdrawal amount is 500 XAF'
            });
        }

        // Check if amount is multiple of 5 (CinetPay requirement for mobile money)
        if (amount % 5 !== 0) {
            return res.status(400).json({
                success: false,
                message: 'Mobile money withdrawal amount must be a multiple of 5'
            });
        }
    } else if (withdrawalType === 'crypto') {
        // Crypto minimum: $10 USD
        if (amount < 10) {
            return res.status(400).json({
                success: false,
                message: 'Minimum crypto withdrawal amount is $10 USD'
            });
        }

        // No multiple of 5 requirement for crypto withdrawals
    }

    next();
};

/**
 * Validate admin user withdrawal request
 */
export const validateAdminUserWithdrawal = (req: Request, res: Response, next: NextFunction) => {
    const { userId, amount, phoneNumber, countryCode, paymentMethod } = req.body;

    if (!userId) {
        log.warn('Validation failed for admin user withdrawal: Missing userId');
        return res.status(400).json({
            success: false,
            message: 'userId is required'
        });
    }

    if (!amount) {
        log.warn('Validation failed for admin user withdrawal: Missing amount');
        return res.status(400).json({
            success: false,
            message: 'Amount is required'
        });
    }

    if (typeof amount !== 'number' || amount <= 0) {
        log.warn('Validation failed for admin user withdrawal: Invalid amount', { amount });
        return res.status(400).json({
            success: false,
            message: 'Amount must be a positive number'
        });
    }

    if (amount < 500) {
        return res.status(400).json({
            success: false,
            message: 'Minimum withdrawal amount is 500'
        });
    }

    if (amount % 5 !== 0) {
        return res.status(400).json({
            success: false,
            message: 'Amount must be a multiple of 5'
        });
    }

    // Validate override parameters if provided
    const hasOverridePhone = phoneNumber !== undefined;
    const hasOverrideCountry = countryCode !== undefined;

    if (hasOverridePhone || hasOverrideCountry) {
        // If any override parameter is provided, both phoneNumber and countryCode are required
        if (!phoneNumber || !countryCode) {
            return res.status(400).json({
                success: false,
                message: 'When using override parameters, both phoneNumber and countryCode are required'
            });
        }

        // Validate country code
        const validCountries = ['CI', 'SN', 'CM', 'TG', 'BJ', 'ML', 'BF', 'GN', 'CD'];
        if (!validCountries.includes(countryCode)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or unsupported country code for override'
            });
        }

        // Validate phone number format
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        if (cleanPhone.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'Invalid phone number format for override'
            });
        }
    }

    next();
};

/**
 * Validate admin direct payout request
 */
export const validateAdminDirectPayout = (req: Request, res: Response, next: NextFunction) => {
    const { amount, phoneNumber, countryCode, recipientName } = req.body;

    const missingFields = [];
    if (!amount) missingFields.push('amount');
    if (!phoneNumber) missingFields.push('phoneNumber');
    if (!countryCode) missingFields.push('countryCode');
    if (!recipientName) missingFields.push('recipientName');

    if (missingFields.length > 0) {
        log.warn('Validation failed for admin direct payout: Missing fields', { missingFields });
        return res.status(400).json({
            success: false,
            message: `Missing required fields: ${missingFields.join(', ')}`
        });
    }

    if (typeof amount !== 'number' || amount <= 0) {
        log.warn('Validation failed for admin direct payout: Invalid amount', { amount });
        return res.status(400).json({
            success: false,
            message: 'Amount must be a positive number'
        });
    }

    if (amount < 500) {
        return res.status(400).json({
            success: false,
            message: 'Minimum payout amount is 500'
        });
    }

    if (amount % 5 !== 0) {
        return res.status(400).json({
            success: false,
            message: 'Amount must be a multiple of 5'
        });
    }

    // Validate country code
    const validCountries = ['CI', 'SN', 'CM', 'TG', 'BJ', 'ML', 'BF', 'GN', 'CD'];
    if (!validCountries.includes(countryCode)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid or unsupported country code'
        });
    }

    // Validate phone number format
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length < 8) {
        return res.status(400).json({
            success: false,
            message: 'Invalid phone number format'
        });
    }

    next();
};