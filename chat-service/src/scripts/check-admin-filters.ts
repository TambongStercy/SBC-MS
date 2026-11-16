/**
 * Admin filters on the status list (GET /api/chat/statuses): ?country matches
 * the free-text `country` in any case or as a FR/EN name; ?from/?to bound
 * createdAt; bad input is a 400. Own throwaway DB, dropped at the end.
 *   npx ts-node --swc src/scripts/check-admin-filters.ts
 */
import assert from 'assert';
import mongoose, { Types } from 'mongoose';
import StatusModel from '../database/models/status.model';
import { statusRepository } from '../database/repositories/status.repository';
import { parseAdminFilters, AdminFilterError } from '../utils/admin-filters';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_chat_filters_check';

(async () => {
    await mongoose.connect(URI, { autoIndex: false });
    await mongoose.connection.dropDatabase();
    try {
        const now = Date.now();
        const live = new Date(now + 12 * 3600_000);
        const at = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000);
        const status = (country: string | undefined, createdAt: Date, extra: Record<string, unknown> = {}) => ({
            authorId: new Types.ObjectId(), category: 'general', content: 'x', mediaType: 'text',
            country, deleted: false, isApproved: true, expiresAt: live, createdAt, updatedAt: createdAt, ...extra,
        });
        await StatusModel.collection.insertMany([
            status('CM', at(1)), status('cm', at(2)), status(' Cameroun ', at(20)), status('Cameroon', at(3)),
            status('CI', at(1)), status("Côte d'Ivoire", at(2)), status(undefined, at(1)),
            status('CM', at(30), { expiresAt: at(6) }), // expired: never in the feed
        ] as any[]);

        const feed = async (q: Record<string, string>) => {
            const f = parseAdminFilters(q);
            return (await statusRepository.getStatusFeed({ country: f.country, from: f.from, to: f.to }, 1, 50)).total;
        };
        assert.strictEqual(await feed({}), 7);
        assert.strictEqual(await feed({ country: 'ALL' }), 7);
        assert.strictEqual(await feed({ country: 'cm' }), 4);
        assert.strictEqual(await feed({ country: 'CI' }), 2);
        assert.strictEqual(await feed({ country: 'SN' }), 0);
        assert.strictEqual(await feed({ country: 'CM', from: at(4).toISOString() }), 3);
        assert.strictEqual(await feed({ to: at(10).toISOString() }), 1);
        assert.throws(() => parseAdminFilters({ country: 'zz9' }), AdminFilterError);
        assert.throws(() => parseAdminFilters({ from: 'hier' }), AdminFilterError);
        console.log('OK chat-service admin filters (status list: country spellings, dates)');
    } finally {
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
    process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
