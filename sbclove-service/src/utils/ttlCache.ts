/**
 * A tiny in-process TTL cache.
 *
 * SBCLOVE's traffic is not spread over the week — it all lands inside the
 * session window (spec §2), so the same handful of reads are repeated by
 * thousands of members within minutes of each other. Caching those for a few
 * seconds turns that spike into a trickle of database and service calls.
 *
 * Per-replica and deliberately not Redis: the values here are small, cheap to
 * recompute, and a few seconds of skew between replicas is harmless. Reach for a
 * shared cache only when a value must be consistent across replicas.
 */
export class TtlCache<V> {
    private store = new Map<string, { value: V; expiresAt: number }>();

    constructor(private ttlMs: number, private maxEntries = 10_000) { }

    get(key: string): V | undefined {
        const hit = this.store.get(key);
        if (!hit) return undefined;
        if (hit.expiresAt <= Date.now()) {
            this.store.delete(key);
            return undefined;
        }
        return hit.value;
    }

    set(key: string, value: V): V {
        // Bounded so a long-lived replica cannot grow one entry per user id.
        // Insertion-ordered Map → the oldest key is the first one out.
        if (this.store.size >= this.maxEntries) {
            const oldest = this.store.keys().next().value;
            if (oldest !== undefined) this.store.delete(oldest);
        }
        this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
    }

    /** Serves from cache, otherwise computes and stores. Concurrent misses each compute. */
    async through(key: string, compute: () => Promise<V>): Promise<V> {
        const hit = this.get(key);
        if (hit !== undefined) return hit;
        return this.set(key, await compute());
    }

    clear(): void {
        this.store.clear();
    }
}
