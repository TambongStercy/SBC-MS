import { createHmac } from 'crypto';
import { config } from '../config';

/** Phone numbers are compared on their last 9 digits (the national number, whatever the dialling code). */
export function phoneKey(raw: unknown): string | null {
    const d = String(raw ?? '').replace(/\D/g, '').replace(/^00/, '');
    return d.length >= 8 ? d.slice(-9) : null;
}

export const hashOf = (kind: string, value: string) => createHmac('sha256', config.hashKey).update(`${kind}:${value}`).digest('hex').slice(0, 40);
export const tailOf = (value: string) => value.slice(-3);

/** Disjoint sets (union by size, path halving) for grouping accounts linked by strong identifiers. */
export class UnionFind {
    private parent = new Map<string, string>();
    private size = new Map<string, number>();
    find(x: string): string {
        if (!this.parent.has(x)) { this.parent.set(x, x); this.size.set(x, 1); return x; }
        let p = this.parent.get(x)!;
        while (p !== this.parent.get(p)) {
            const gp = this.parent.get(this.parent.get(p)!)!;
            this.parent.set(p, gp);
            p = gp;
        }
        this.parent.set(x, p);
        return p;
    }
    union(a: string, b: string): void {
        let ra = this.find(a), rb = this.find(b);
        if (ra === rb) return;
        if ((this.size.get(ra) ?? 1) < (this.size.get(rb) ?? 1)) [ra, rb] = [rb, ra];
        this.parent.set(rb, ra);
        this.size.set(ra, (this.size.get(ra) ?? 1) + (this.size.get(rb) ?? 1));
    }
    groups(): Map<string, string[]> {
        const out = new Map<string, string[]>();
        for (const x of this.parent.keys()) {
            const r = this.find(x);
            const list = out.get(r) ?? [];
            list.push(x);
            out.set(r, list);
        }
        return out;
    }
}
