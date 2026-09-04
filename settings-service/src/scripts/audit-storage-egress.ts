/**
 * Where the Cloud Storage bill comes from.
 *
 * August 2026 cost $79.63, of which $64.32 was 636 GiB of download egress and
 * only $1.23 was storage. Storage size is therefore not the question — what is
 * being downloaded, how big it is, and how many people pull it is.
 *
 * Objects are served straight off storage.googleapis.com, so nothing sits in
 * front of them: no shared cache, no CDN. Each object carries a one-year
 * Cache-Control, so a returning browser re-reads its own copy for free, but every
 * NEW visitor pays full size in egress. A 55 MB creative on a landing page is
 * therefore 55 MB per distinct visitor, forever.
 *
 * This lists both buckets by folder and by size band, so the handful of objects
 * responsible for the bill are visible instead of guessed at. Read-only.
 *
 * Usage (on the server, in settings-service/):
 *   npx ts-node src/scripts/audit-storage-egress.ts
 *   npx ts-node src/scripts/audit-storage-egress.ts --top 40
 */

import { Storage } from '@google-cloud/storage';

const BUCKETS = ['sbc-file-storage', 'sbc-status-media-private'];
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const topN = (() => {
    const i = process.argv.indexOf('--top');
    return i > -1 ? parseInt(process.argv[i + 1], 10) || 20 : 20;
})();

const human = (bytes: number) =>
    bytes >= GIB ? `${(bytes / GIB).toFixed(2)} GiB`
        : bytes >= MIB ? `${(bytes / MIB).toFixed(1)} MiB`
            : `${Math.round(bytes / 1024)} KiB`;

type Group = { count: number; bytes: number; largest: number };
const blank = (): Group => ({ count: 0, bytes: 0, largest: 0 });

const add = (map: Map<string, Group>, key: string, bytes: number) => {
    const g = map.get(key) ?? blank();
    g.count++;
    g.bytes += bytes;
    g.largest = Math.max(g.largest, bytes);
    map.set(key, g);
};

/**
 * Size bands, because the bill is driven by the tail. Ten thousand 40 KiB
 * thumbnails cost less than two hundred 50 MiB videos, and an average hides that
 * completely.
 */
const band = (bytes: number): string =>
    bytes >= 50 * MIB ? 'e. 50 MiB +'
        : bytes >= 10 * MIB ? 'd. 10-50 MiB'
            : bytes >= MIB ? 'c. 1-10 MiB'
                : bytes >= 100 * 1024 ? 'b. 100 KiB - 1 MiB'
                    : 'a. under 100 KiB';

const report = (title: string, map: Map<string, Group>, total: number) => {
    console.log(`\n  ${title}`);
    const rows = [...map.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
    for (const [key, g] of rows) {
        const share = total ? ((g.bytes / total) * 100).toFixed(1) : '0.0';
        console.log(
            `    ${key.padEnd(26)} ${String(g.count).padStart(7)} files  `
            + `${human(g.bytes).padStart(10)}  ${share.padStart(5)}%  `
            + `largest ${human(g.largest)}`,
        );
    }
};

const auditBucket = async (storage: Storage, name: string) => {
    console.log(`\n${'='.repeat(78)}\n${name}\n${'='.repeat(78)}`);

    const byFolder = new Map<string, Group>();
    const byType = new Map<string, Group>();
    const byBand = new Map<string, Group>();
    const biggest: Array<{ name: string; bytes: number; type: string; updated?: string }> = [];

    let total = 0;
    let count = 0;

    // Paged rather than getFiles({}) in one shot: these buckets hold tens of
    // thousands of objects and the whole listing does not need to be resident.
    let pageToken: string | undefined;
    do {
        const [files, next] = await storage.bucket(name).getFiles({
            maxResults: 1000,
            pageToken,
            autoPaginate: false,
        }) as any;

        for (const f of files) {
            const bytes = Number(f.metadata.size ?? 0);
            const type = String(f.metadata.contentType ?? 'unknown');
            total += bytes;
            count++;

            add(byFolder, f.name.includes('/') ? f.name.split('/')[0] : '(root)', bytes);
            add(byType, type.split(';')[0], bytes);
            add(byBand, band(bytes), bytes);

            biggest.push({ name: f.name, bytes, type, updated: f.metadata.updated });
        }

        // Bounded: only the tail matters, and holding every object would defeat
        // the paging above on a bucket this size.
        biggest.sort((a, b) => b.bytes - a.bytes);
        biggest.length = Math.min(biggest.length, topN);

        pageToken = next?.pageToken;
    } while (pageToken);

    console.log(`\n  ${count} objects, ${human(total)} stored`);

    report('By folder', byFolder, total);
    report('By content type', byType, total);
    report('By size band', byBand, total);

    console.log(`\n  ${topN} largest objects — each of these is re-downloaded in full per new viewer`);
    for (const f of biggest) {
        console.log(
            `    ${human(f.bytes).padStart(10)}  ${String(f.type).padEnd(18)} `
            + `${f.updated ? String(f.updated).slice(0, 10) : '          '}  ${f.name}`,
        );
    }

    return { count, total };
};

const run = async () => {
    const storage = new Storage();

    let grand = 0;
    for (const bucket of BUCKETS) {
        try {
            const { total } = await auditBucket(storage, bucket);
            grand += total;
        } catch (err) {
            console.error(`\n${bucket}: could not be read — ${(err as Error).message}`);
        }
    }

    console.log(`\n${'='.repeat(78)}`);
    console.log(`Stored across both buckets: ${human(grand)}`);
    console.log(
        'Egress is what costs money, not this. Multiply each file by the number of\n'
        + 'distinct people who load it: that product is the bill.',
    );
};

run().catch(err => {
    console.error(err);
    process.exit(1);
});
