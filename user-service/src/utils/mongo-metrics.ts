/**
 * MongoDB, read by user-service at each scrape with serverStatus (one cheap command, 2 s budget).
 * Item 11: keep the working set in memory, so the WiredTiger cache use and the dirty share
 * are watched, with the connections.
 *   sbc_mongo_cache_bytes{kind=used|dirty|max}, sbc_mongo_connections{state=current|available}, sbc_mongo_up
 */
import mongoose from 'mongoose';
import client from 'prom-client';
import { registry } from './metrics';

async function status(): Promise<any> {
    const db = mongoose.connection.db;
    if (!db) return null;
    try {
        return await Promise.race([
            db.admin().command({ serverStatus: 1, repl: 0, metrics: 0, locks: 0, opLatencies: 0 }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
        ]);
    } catch {
        return null;
    }
}

// One serverStatus per scrape, shared by the three gauges (prom-client collects them in parallel).
let pending: { at: number; p: Promise<any> } | null = null;
const current = () => {
    if (!pending || Date.now() - pending.at > 1000) pending = { at: Date.now(), p: status() };
    return pending.p;
};

new client.Gauge({
    name: 'sbc_mongo_up', help: '1 when serverStatus answered at the last scrape', registers: [registry],
    async collect() { this.set((await current()) ? 1 : 0); },
});
new client.Gauge({
    name: 'sbc_mongo_cache_bytes', help: 'WiredTiger cache', labelNames: ['kind'], registers: [registry],
    async collect() {
        const wt = (await current())?.wiredTiger?.cache;
        if (!wt) return;
        this.set({ kind: 'used' }, Number(wt['bytes currently in the cache'] ?? 0));
        this.set({ kind: 'dirty' }, Number(wt['tracked dirty bytes in the cache'] ?? 0));
        this.set({ kind: 'max' }, Number(wt['maximum bytes configured'] ?? 0));
    },
});
new client.Gauge({
    name: 'sbc_mongo_connections', help: 'Connections to MongoDB', labelNames: ['state'], registers: [registry],
    async collect() {
        const c = (await current())?.connections;
        if (!c) return;
        this.set({ state: 'current' }, Number(c.current ?? 0));
        this.set({ state: 'available' }, Number(c.available ?? 0));
    },
});
