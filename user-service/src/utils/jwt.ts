import jwt, { SignOptions, Secret } from 'jsonwebtoken';
import config from '../config';

export const signToken = (payload: object): string => {
    return jwt.sign(
        payload,
        config.jwt.secret,
        {
            expiresIn: config.jwt.expiresIn,
        } as SignOptions
    );
};

export const verifyToken = (token: string): string | object => {
    try {
        return jwt.verify(token, config.jwt.secret);
    } catch (error) {
        // Handle specific errors like TokenExpiredError, JsonWebTokenError if needed
        throw new Error('Invalid or expired token');
    }
}; 