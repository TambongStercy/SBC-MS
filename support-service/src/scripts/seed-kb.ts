/**
 * Seeds the starter help articles (src/data/kb-starter.ts) so the member Aide
 * and the assistant have something to answer from on day one.
 *
 *   npx ts-node src/scripts/seed-kb.ts              dry run: lists what would be created
 *   npx ts-node src/scripts/seed-kb.ts --apply      creates the missing articles as drafts
 *   npx ts-node src/scripts/seed-kb.ts --publish    also publishes the seeded drafts nobody edited
 *   node dist/scripts/seed-kb.js …                  same, on the server after build
 *
 * Never overwrites an article that already exists (same slug), and never
 * publishes an article an agent has edited since the seed: those are published
 * from the agent app (Contenus) after review. Every creation and publication is audited.
 */
import mongoose from 'mongoose';
import { connectDB } from '../lib/db';
import { closeRedis } from '../lib/redis';
import { KbArticle } from '../database/models/kb.model';
import { KB_STARTER } from '../data/kb-starter';
import { createArticle, publish } from '../services/kb.service';
import { audit } from '../services/audit.service';

const SEED_BY = 'seed:kb-starter';
const actor = { type: 'system' as const, id: 'seed-kb', name: 'CLI' };

async function main() {
    const apply = process.argv.includes('--apply') || process.argv.includes('--publish');
    const doPublish = process.argv.includes('--publish');
    await connectDB();
    let created = 0; let published = 0;
    for (const a of KB_STARTER) {
        const existing = await KbArticle.findOne({ slug: a.slug }).lean();
        if (existing) {
            const untouched = existing.status === 'draft' && existing.updatedBy === SEED_BY && !existing.published;
            if (doPublish && untouched) {
                await publish(String(existing._id), SEED_BY);
                await audit({ actor, action: 'kb.published', target: { type: 'article', id: String(existing._id) }, after: { slug: a.slug, via: 'seed' } });
                published += 1;
                process.stdout.write(`published  ${a.slug}\n`);
            } else {
                process.stdout.write(`kept       ${a.slug} (${existing.status}${existing.updatedBy === SEED_BY ? '' : ', edited'})\n`);
            }
            continue;
        }
        if (!apply) { process.stdout.write(`would add  ${a.slug} — ${a.title}\n`); continue; }
        const doc = await createArticle({ slug: a.slug, category: a.category, tags: a.tags, title: a.title, summary: a.summary, body: a.body }, SEED_BY);
        await audit({ actor, action: 'kb.created', target: { type: 'article', id: String(doc._id) }, after: { slug: a.slug, via: 'seed' } });
        created += 1;
        if (doPublish) {
            await publish(String(doc._id), SEED_BY);
            await audit({ actor, action: 'kb.published', target: { type: 'article', id: String(doc._id) }, after: { slug: a.slug, via: 'seed' } });
            published += 1;
            process.stdout.write(`added+pub  ${a.slug}\n`);
        } else {
            process.stdout.write(`added      ${a.slug} (draft)\n`);
        }
    }
    process.stdout.write(apply ? `\n${created} created, ${published} published.\n` : '\nDry run: nothing written. Add --apply (drafts) or --publish.\n');
    await closeRedis();
    await mongoose.disconnect();
}

main().catch(async (err) => {
    process.stderr.write(`Failed: ${(err as Error).message}\n`);
    await closeRedis().catch(() => undefined);
    process.exit(1);
});
