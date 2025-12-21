import jwt, { SignOptions } from 'jsonwebtoken';
import config from '../config';

export interface JwtPayload {
    id: string;
    userId: string;
    email: string;
    role: string;
    name?: string;
    iat?: number;
    exp?: number;
}

export const signToken = (payload: object): string => {
    return jwt.sign(
        payload,
        config.jwt.secret,
        {
            expiresIn: config.jwt.expiresIn,
        } as SignOptions
    );
};

export const verifyToken = (token: string): JwtPayload => {
    try {
        const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
        return decoded;
    } catch (error) {
        throw new Error('Invalid or expired token');
    }
};
