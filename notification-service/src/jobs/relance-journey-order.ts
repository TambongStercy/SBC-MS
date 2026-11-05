/**
 * A parrain's due targets in the order they should go out: his journeys
 * (relance des nouveaux, then each campaign) take turns, each oldest due first.
 *
 * Relance gets a small shared daily total, so a parrain is rarely sent more
 * than a few dozen a day. In database order his relance-des-nouveaux backlog
 * used up all of it, and a campaign launched on 2026-10-30 had sent nothing
 * a week later (562 filleuls, 0 messages).
 */
export function interleaveJourneys<T extends { campaignId?: any; nextMessageDue: Date }>(targets: T[]): T[] {
    const journeys = new Map<string, T[]>();
    for (const t of targets) {
        const key = t.campaignId ? String(t.campaignId._id ?? t.campaignId) : 'default';
        if (!journeys.has(key)) journeys.set(key, []);
        journeys.get(key)!.push(t);
    }
    const queues = Array.from(journeys.values()).map(q =>
        q.sort((a, b) => new Date(a.nextMessageDue).getTime() - new Date(b.nextMessageDue).getTime()));
    const out: T[] = [];
    for (let i = 0; out.length < targets.length; i++) {
        for (const q of queues) if (i < q.length) out.push(q[i]);
    }
    return out;
}
