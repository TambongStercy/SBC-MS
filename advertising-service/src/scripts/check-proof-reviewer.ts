/**
 * Moderators work the video-proof queue and nothing else in the ads admin API.
 * Mounts the real admin router on a throwaway app against a local Mongo.
 *   JWT_SECRET=x MONGODB_URI=mongodb://127.0.0.1:27017/sbc_ads_check npx ts-node src/scripts/check-proof-reviewer.ts
 */
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import http from 'http';
import config from '../config';
import adminRoutes from '../api/routes/admin.routes';

const tokenFor = (role: string) => jwt.sign({ userId: new mongoose.Types.ObjectId().toString(), role }, config.jwt.secret);

async function main() {
    await mongoose.connect(config.mongodb.uri);
    const app = express();
    app.use(express.json());
    app.use('/admin', adminRoutes);
    // the service's error handler shape, enough to read status codes
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 500).json({ message: err.message }));
    const server = app.listen(0);
    const port = (server.address() as any).port;
    const call = (path: string, role: string) => new Promise<number>(resolve => {
        http.get({ port, path, headers: { Authorization: `Bearer ${tokenFor(role)}` } }, r => { r.resume(); resolve(r.statusCode || 0); });
    });

    const cases: Array<[string, string, number]> = [
        ['/admin/manual-verifications', 'moderator', 200],
        ['/admin/manual-verifications', 'admin', 200],
        ['/admin/manual-verifications', 'user', 403],
        ['/admin/analytics', 'moderator', 403],
        ['/admin/campaigns', 'moderator', 403],
        ['/admin/diffuseurs', 'moderator', 403],
        ['/admin/analytics', 'admin', 200],
    ];
    let failed = 0;
    for (const [path, role, want] of cases) {
        const got = await call(path, role);
        const ok = got === want;
        if (!ok) failed++;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${role.padEnd(9)} GET ${path} -> ${got} (want ${want})`);
    }
    server.close();
    await mongoose.disconnect();
    process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
