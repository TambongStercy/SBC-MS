import config from '../config';

/**
 * Where payment-service may send its status callbacks.
 *
 * Every callback carries `Authorization: Bearer <SERVICE_SECRET>`, so a
 * callback to a foreign host hands that host the key to every internal route.
 * Intent creation now requires service auth, which is what closes the hole;
 * this check is the second line: a callback may only go to one of our own
 * services.
 *
 * Allowed: loopback (services share the host), the origins of the service URLs
 * configured here, our own base URL, and PAYMENT_CALLBACK_ALLOWED_ORIGINS
 * (comma-separated origins, e.g. "http://localhost:3011,https://api.example.com").
 *
 * Unknown origins are only logged until PAYMENT_CALLBACK_ENFORCE_ALLOWLIST=true:
 * a wrong allowlist would silently stop every payment confirmation (paid but
 * never delivered), so turn enforcement on only after the logs show no
 * "would be blocked" line for a legitimate service.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const originOf = (url?: string): string | null => {
    if (!url) return null;
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
};

const allowedOrigins = (): Set<string> => {
    const origins = new Set<string>();
    const s = config.services;
    for (const url of [
        s.userServiceUrl, s.notificationServiceUrl, s.productServiceUrl,
        s.advertisingServiceUrl, s.tombolaServiceUrl, config.selfBaseUrl,
    ]) {
        const origin = originOf(url);
        if (origin) origins.add(origin);
    }
    for (const raw of (process.env.PAYMENT_CALLBACK_ALLOWED_ORIGINS || '').split(',')) {
        const origin = originOf(raw.trim());
        if (origin) origins.add(origin);
    }
    return origins;
};

export const callbackAllowlistEnforced = (): boolean =>
    process.env.PAYMENT_CALLBACK_ENFORCE_ALLOWLIST === 'true';

export const checkCallbackUrl = (url: string): { allowed: boolean; reason?: string } => {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { allowed: false, reason: 'not a valid absolute URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { allowed: false, reason: `protocol ${parsed.protocol} not allowed` };
    }
    if (LOOPBACK_HOSTS.has(parsed.hostname)) return { allowed: true };
    if (allowedOrigins().has(parsed.origin)) return { allowed: true };
    return { allowed: false, reason: `origin ${parsed.origin} is not an allowed service origin` };
};
