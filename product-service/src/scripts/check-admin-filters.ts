/**
 * Asserts the admin filters `?country=`, `?from=`, `?to=` (admin plan, phase 3)
 * on GET /api/products/admin and GET /api/flash-sales/admin.
 *
 * Country = the SELLER's (product `userId`, flash sale `sellerUserId`);
 * user-service is stubbed (setCountryMembersResolver). Dates: products on
 * `createdAt`, flash sales on `startTime`.
 *
 * Own database, dropped at the end. WhatsApp-link lookups go to USER_SERVICE_URL;
 * point it nowhere so they fail fast (best-effort):
 *   USER_SERVICE_URL=http://127.0.0.1:9 npx ts-node --swc src/scripts/check-admin-filters.ts
 */
import assert from 'assert';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import mongoose, { Types } from 'mongoose';
import config from '../config';
import routes from '../api/routes';
import ProductModel from '../database/models/product.model';
import FlashSaleModel, { FlashSaleStatus } from '../database/models/flashsale.model';
import { setCountryMembersResolver } from '../utils/country-members';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_product_filters_check';
const adminId = new Types.ObjectId().toString();
const ADMIN = jwt.sign({ userId: adminId, id: adminId, role: 'admin' }, config.jwt.secret, { expiresIn: '1h' });

const S1 = new Types.ObjectId(); // CM
const S2 = new Types.ObjectId(); // BJ
const S3 = new Types.ObjectId(); // country unknown to the stub
const MEMBERS: Record<string, Types.ObjectId[]> = { CM: [S1, new Types.ObjectId()], BJ: [S2] };

async function main() {
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
    setCountryMembersResolver(async c => (MEMBERS[c] ?? []).map(String));

    const app = express();
    app.use(express.json());
    app.use('/api', routes);
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
        res.status(err.statusCode || 500).json({ success: false, message: err.message }));
    const server: http.Server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const get = async (path: string) => {
        const r = await fetch(base + path, { headers: { Authorization: `Bearer ${ADMIN}` } });
        return { status: r.status, json: await r.json().catch(() => null) as any };
    };
    const products = async (q: string) => {
        const r = await get(`/products/admin?limit=50&${q}`);
        assert.strictEqual(r.status, 200, `${q}: ${JSON.stringify(r.json)}`);
        return r.json.pagination.totalCount as number;
    };
    const sales = async (q: string) => {
        const r = await get(`/flash-sales/admin?limit=50&${q}`);
        assert.strictEqual(r.status, 200, `${q}: ${JSON.stringify(r.json)}`);
        return r.json.data.totalCount as number;
    };

    try {
        const product = async (userId: Types.ObjectId, createdAt: Date, over: Record<string, unknown> = {}) => {
            const p = await ProductModel.create({
                userId, name: 'Robe', category: 'mode', subcategory: 'robes', description: 'M', price: 1000, ...over,
            });
            await ProductModel.collection.updateOne({ _id: p._id }, { $set: { createdAt } });
            return p;
        };
        const now = new Date();
        const p1 = await product(S1, now);
        await product(S1, new Date('2025-03-01'));
        await product(S1, now, { deleted: true, deletedAt: now });
        const p2 = await product(S2, now);
        await product(S3, now);

        const sale = (productId: Types.ObjectId, sellerUserId: Types.ObjectId, startTime: Date) => FlashSaleModel.create({
            productId, sellerUserId, originalPrice: 1000, discountedPrice: 800,
            startTime, endTime: new Date(startTime.getTime() + 86400e3), status: FlashSaleStatus.EXPIRED,
        });
        await sale(p1._id as Types.ObjectId, S1, new Date('2025-03-10'));
        await sale(p2._id as Types.ObjectId, S2, now);

        // --- Products (default status lists every product, removed ones included) ---
        assert.strictEqual(await products(''), 5);
        assert.strictEqual(await products('country=CM'), 3);
        assert.strictEqual(await products('country=cm'), 3, 'case-insensitive');
        assert.strictEqual(await products('country=ALL'), 5);
        assert.strictEqual(await products('country=BJ'), 1);
        assert.strictEqual(await products('country=XX'), 0, 'unknown country: nobody');
        assert.strictEqual(await products('from=2025-01-01&to=2025-12-31'), 1);
        assert.strictEqual(await products('to=2025-03-01'), 1, 'bare `to` = end of that day');
        assert.strictEqual(await products('country=CM&to=2025-12-31'), 1);
        assert.strictEqual(await products(`country=CM&userId=${S2}`), 0, 'country and userId both hold');
        assert.strictEqual(await products(`country=CM&userId=${S1}`), 3);
        assert.strictEqual(await products('country=CM&status=approved'), 2, 'deleted one excluded by status');
        assert.strictEqual(await products('country=CM&status=pending'), 0);
        assert.strictEqual(await products('country=CM&status=deleted'), 1);

        // --- Flash sales (country/from/to never reach the raw field filter) ---
        assert.strictEqual(await sales(''), 2);
        assert.strictEqual(await sales('country=CM'), 1);
        assert.strictEqual(await sales('country=BJ&from=2025-01-01&to=2025-12-31'), 0);
        assert.strictEqual(await sales('from=2025-03-01&to=2025-03-31'), 1, 'on startTime');
        assert.strictEqual(await sales(`country=CM&sellerUserId=${S2}`), 0);
        assert.strictEqual(await sales('country=CM&status=expired'), 1);

        // --- Bad input → 400 (French) ---
        for (const path of ['/products/admin', '/flash-sales/admin']) {
            for (const q of ['country=zz9', 'from=hier', 'from=2025-02-01&to=2025-01-01']) {
                const r = await get(`${path}?${q}`);
                assert.strictEqual(r.status, 400, `${path}?${q}`);
                assert.strictEqual(r.json.success, false);
            }
        }

        // --- user-service down → 502, never "no filter" ---
        setCountryMembersResolver(async () => { throw new Error('ECONNREFUSED'); });
        for (const path of ['/products/admin', '/flash-sales/admin']) {
            const r = await get(`${path}?country=CM`);
            assert.strictEqual(r.status, 502, path);
            assert.strictEqual(r.json.message, 'Filtre pays indisponible : le service utilisateurs ne répond pas.');
            assert.strictEqual((await get(path)).status, 200, `${path} without a country does not need user-service`);
        }
    } finally {
        server.close();
        await Promise.all([ProductModel.init(), FlashSaleModel.init()]).catch(() => undefined);
        await mongoose.connection.dropDatabase().catch(() => undefined);
        await mongoose.disconnect();
    }
    console.log('OK admin filters: /products/admin, /flash-sales/admin (country, from/to, 400, 502)');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
