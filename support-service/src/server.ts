import config from './config';
import { connectDB, closeDB } from './lib/db';
import { closeRedis, redis } from './lib/redis';
import { createApp } from './app';
import { startJobs, stopJobs } from './jobs';
import logger from './utils/logger';

const log = logger.getLogger('Server');

async function main() {
    await connectDB();
    redis();
    const app = createApp();
    const server = app.listen(config.port, () => log.info(`support-service listening on ${config.port} (${config.nodeEnv})`));
    if (config.jobsEnabled) await startJobs();

    const shutdown = (signal: string) => {
        log.warn(`${signal} received, shutting down`);
        server.close(async () => {
            await stopJobs();
            await closeRedis();
            await closeDB().catch(() => undefined);
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
    log.error('Fatal startup error', err);
    process.exit(1);
});
