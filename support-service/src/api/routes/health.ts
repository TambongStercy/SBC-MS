import { Request, Response } from 'express';
import mongoose from 'mongoose';
import config from '../../config';
import { redis } from '../../lib/redis';

type DepState = 'up' | 'down';
let depCache: { at: number; value: Record<string, DepState> } | null = null;

async function ping(url: string): Promise<DepState> {
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
        return r.ok ? 'up' : 'down';
    } catch {
        return 'down';
    }
}

async function dependencies(): Promise<Record<string, DepState>> {
    if (depCache && Date.now() - depCache.at < 30_000) return depCache.value;
    const s = config.services;
    const [user, payment, advertising, notification] = await Promise.all([
        ping(`${s.user}/health`), ping(`${s.payment}/health`), ping(`${s.advertising}/api/health`).then((x) => (x === 'up' ? x : ping(`${s.advertising}/health`))),
        ping(`${s.notification}/health`),
    ]);
    const value = { user, payment, advertising, notification };
    depCache = { at: Date.now(), value };
    return value;
}

/** 200 when Mongo and Redis answer; dependencies are reported, never fatal. */
export async function health(_req: Request, res: Response): Promise<void> {
    const mongo = mongoose.connection.readyState === 1 ? 'up' : 'down';
    let redisState: DepState = 'down';
    try {
        redisState = (await Promise.race([redis().ping(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))])) === 'PONG' ? 'up' : 'down';
    } catch { redisState = 'down'; }
    const ok = mongo === 'up' && redisState === 'up';
    res.status(ok ? 200 : 503).json({
        status: ok ? 'UP' : 'DEGRADED', service: config.serviceName, mongo, redis: redisState,
        dependencies: await dependencies(), time: new Date().toISOString(),
    });
}
