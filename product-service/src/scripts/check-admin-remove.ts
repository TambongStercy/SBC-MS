/**
 * Asserts DELETE /api/products/admin/:productId (2026-10-04): an admin can take
 * any member's product offline, its live flash sales are cancelled, a member
 * cannot use the route, and restore brings the product back.
 *
 * Runs against a throwaway database on local Mongo:
 *   npx ts-node src/scripts/check-admin-remove.ts
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import mongoose, { Types } from 'mongoose';
import config from '../config';
import productRoutes from '../api/routes/product.routes';
import ProductModel from '../database/models/product.model';
import FlashSaleModel, { FlashSaleStatus } from '../database/models/flashsale.model';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_products_admin_remove_check';
const token = (role: string) => { const id = new Types.ObjectId().toString(); return jwt.sign({ userId: id, id, role }, config.jwt.secret, { expiresIn: '1h' }); };

let failures = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };

async function main() {
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
    const app = express();
    app.use(express.json());
    app.use('/api/products', productRoutes);
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));
    const server: http.Server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/products`;
    const call = async (method: string, path: string, auth: string) => {
        const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${auth}` } });
        return { status: r.status, json: await r.json().catch(() => null) as any };
    };

    try {
        const seller = new Types.ObjectId();
        const product = await ProductModel.create({ userId: seller, name: 'Robe wax', category: 'mode', subcategory: 'robes', description: 'Taille M', images: [{ url: '/settings/files/x', fileId: 'x' }], price: 15000, status: 'approved' });
        const now = Date.now();
        const sale = (status: FlashSaleStatus) => FlashSaleModel.create({ productId: product._id, sellerUserId: seller, originalPrice: 15000, discountedPrice: 9000, startTime: new Date(now - 3600e3), endTime: new Date(now + 3600e3), status, feePaymentStatus: 'succeeded' });
        const live = await sale(FlashSaleStatus.ACTIVE);
        const upcoming = await sale(FlashSaleStatus.SCHEDULED);
        const over = await sale(FlashSaleStatus.EXPIRED);

        const member = await call('DELETE', `/admin/${product._id}`, token('user'));
        check('a member is refused', member.status === 403);
        check('...and the product stays', !(await ProductModel.findById(product._id).lean())?.deleted);

        const admin = token('admin');
        const r = await call('DELETE', `/admin/${product._id}`, admin);
        check('an admin removes a product they do not own', r.status === 200);
        const after: any = await ProductModel.collection.findOne({ _id: product._id });
        check('...as a soft delete', after?.deleted === true && !!after?.deletedAt);
        check('...cancelling its live and upcoming flash sales (2)', r.json?.flashSalesCancelled === 2);
        check('...live sale cancelled', (await FlashSaleModel.findById(live._id).lean())?.status === FlashSaleStatus.CANCELLED);
        check('...upcoming sale cancelled', (await FlashSaleModel.findById(upcoming._id).lean())?.status === FlashSaleStatus.CANCELLED);
        check('...finished sale left alone', (await FlashSaleModel.findById(over._id).lean())?.status === FlashSaleStatus.EXPIRED);

        check('removing it again answers 404', (await call('DELETE', `/admin/${product._id}`, admin)).status === 404);
        check('a malformed id answers 400', (await call('DELETE', '/admin/not-an-id', admin)).status === 400);

        const restored = await call('PATCH', `/admin/${product._id}/restore`, admin);
        check('restore brings it back', restored.status === 200 && (await ProductModel.collection.findOne({ _id: product._id }))?.deleted === false);
    } finally {
        server.close();
        await mongoose.connection.dropDatabase().catch(() => undefined);
        await mongoose.disconnect();
    }
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
