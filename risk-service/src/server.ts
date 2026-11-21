import express from 'express';
import mongoose from 'mongoose';
import { config } from './config';
import { connectDB } from './lib/db';
import { closeRedis, redis } from './lib/redis';
import { childLogger } from './lib/logger';
import { routes } from './api/routes';
import { flushOutbox } from './services/support.client';

const log = childLogger('Server');

export function createApp() {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 'loopback');
    app.use(express.json({ limit: '64kb' }));
    app.use(routes());
    app.use((_req, res) => res.status(404).json({ success: false, message: 'Not found' }));
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        log.error({ message: err?.message }, 'request failed');
        res.status(500).json({ success: false, message: 'Erreur interne' });
    });
    return app;
}

async function main() {
    await connectDB();
    redis();
    const server = createApp().listen(config.port, () => log.info({ port: config.port }, 'risk-service listening'));
    const outbox = setInterval(() => { flushOutbox().catch((e) => log.warn({ message: e?.message }, 'outbox flush failed')); }, 30_000);

    const shutdown = (signal: string) => {
        log.warn({ signal }, 'shutting down');
        clearInterval(outbox);
        server.close(async () => {
            await closeRedis();
            await mongoose.disconnect().catch(() => undefined);
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
    main().catch((err) => { log.error({ message: err?.message }, 'fatal startup error'); process.exit(1); });
}
