/*
 * Member tokens for the load test, signed like user-service signs them
 * (HS256, { userId, id, email, role }), so the journeys do not go through the
 * emailed sign-in code. Preprod's JWT_SECRET only.
 */
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';

const cache = {};

export function mintToken(user, secret) {
    if (!secret) throw new Error('JWT_SECRET is required to sign member tokens.');
    const hit = cache[user.id];
    const now = Math.floor(Date.now() / 1000);
    if (hit && hit.exp - now > 300) return hit.token;
    const exp = now + 3600;
    const header = encoding.b64encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'rawurl');
    const payload = encoding.b64encode(JSON.stringify({
        userId: user.id, id: user.id, email: user.email, role: user.role || 'user', iat: now, exp,
    }), 'rawurl');
    const signature = crypto.hmac('sha256', secret, `${header}.${payload}`, 'base64rawurl');
    const token = `${header}.${payload}.${signature}`;
    cache[user.id] = { token, exp };
    return token;
}
