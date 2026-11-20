import { Types } from 'mongoose';
import { ClientErrorDay, ClientErrorMember, ClientErrorType, CLIENT_ERROR_STATES, type ClientErrorState } from '../database/models/client-error.model';
import { cleanReplay } from './replay.service';
import { badRequest, notFound } from '../utils/errors';

/** Day key in Douala time (the members' day), YYYY-MM-DD. */
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Douala', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = (d: Date) => DAY_FMT.format(d);

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ID_SEGMENT = [/^[0-9a-f]{24}$/i, /^\d+$/, /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i, /^SUP-\d+$/i, /^[A-Za-z0-9_-]{20,}$/];

/** `/api/support/me/tickets/6afe…?x=1` → `/api/support/me/tickets/:id`: one type per call, whatever the id. */
export function normalizeRoute(path: unknown): string | null {
    if (typeof path !== 'string') return null;
    const p = path.split(/[?#]/)[0];
    if (!p.startsWith('/api/') || p.length > 400) return null;
    const segs = p.split('/').filter(Boolean).slice(0, 10).map((s) => {
        let v = s;
        try { v = decodeURIComponent(s); } catch { /* keep as is */ }
        return ID_SEGMENT.some((re) => re.test(v)) ? ':id' : v.replace(/[^\w.:-]/g, '').slice(0, 40);
    });
    return `/${segs.join('/')}`.slice(0, 200);
}

/** The server's message without personal data: no emails, no long digit runs (phones, amounts, references). */
export function cleanMessage(m: unknown): string | null {
    if (typeof m !== 'string' || !m.trim()) return null;
    return m.replace(/[^\s@]+@[^\s@]+/g, '•@•').replace(/\d[\d\s.-]{4,}\d/g, '•••').replace(/\s+/g, ' ').trim().slice(0, 300);
}

type Item = { method?: unknown; path?: unknown; status?: unknown; code?: unknown; message?: unknown; replay?: unknown };

/**
 * Records the failed calls a member's app reports (at most 20 per batch). A type that
 * was marked fixed and happens again is reopened and counted as a regression.
 */
export async function recordClientErrors(memberId: string, items: unknown): Promise<{ recorded: number }> {
    if (!Array.isArray(items) || items.length === 0) return { recorded: 0 };
    if (items.length > 20) throw badRequest('Trop d’erreurs dans un envoi (20 au plus).', 'TOO_MANY');
    const now = new Date();
    const day = dayKey(now);
    const groups = new Map<string, { method: string; route: string; status: number; code: string | null; message: string | null; count: number; replay: ReturnType<typeof cleanReplay> }>();
    for (const raw of items as Item[]) {
        const method = typeof raw?.method === 'string' ? raw.method.toUpperCase() : '';
        const status = Number(raw?.status);
        const route = normalizeRoute(raw?.path);
        if (!METHODS.has(method) || !route || !Number.isInteger(status) || !(status === 0 || (status >= 400 && status <= 599))) continue;
        if (route.startsWith('/api/support/me/client-errors')) continue; // never about itself
        const code = typeof raw?.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(raw.code) ? raw.code : null;
        const signature = `${method} ${route} ${status}${code ? ` ${code}` : ''}`;
        const g = groups.get(signature);
        if (g) { g.count++; continue; }
        groups.set(signature, { method, route, status, code, message: cleanMessage(raw?.message), count: 1, replay: cleanReplay(raw?.replay, now) });
    }
    let recorded = 0;
    for (const [signature, g] of groups) {
        const before = await ClientErrorType.findOneAndUpdate(
            { signature },
            {
                $setOnInsert: { method: g.method, route: g.route, status: g.status, code: g.code, firstSeen: now, state: 'open', regressions: 0 },
                $set: { lastSeen: now, ...(g.message ? { lastMessage: g.message } : {}), ...(g.replay ? { lastReplay: g.replay } : {}) },
                $inc: { total: g.count },
            },
            { upsert: true, new: false },
        ).lean();
        const type = before ?? (await ClientErrorType.findOne({ signature }, { _id: 1 }).lean());
        if (!type) continue;
        if (before?.state === 'resolved') {
            await ClientErrorType.updateOne({ _id: type._id, state: 'resolved' }, { $set: { state: 'open', stateAt: now, lastRegressionAt: now }, $inc: { regressions: 1 } });
        }
        await ClientErrorDay.updateOne({ typeId: type._id, day }, { $inc: { count: g.count }, $setOnInsert: { createdAt: now } }, { upsert: true });
        await ClientErrorMember.updateOne({ typeId: type._id, day, memberId }, { $setOnInsert: { createdAt: now } }, { upsert: true }).catch(() => undefined);
        recorded += g.count;
    }
    return { recorded };
}

/** Support administrator: « en cours de traitement » or « corrigé », with an optional note. */
export async function setClientErrorState(id: string, state: unknown, note: unknown, by: { id: string; name: string }) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    if (typeof state !== 'string' || !CLIENT_ERROR_STATES.includes(state as ClientErrorState)) throw badRequest('État inconnu.', 'BAD_STATE');
    const text = typeof note === 'string' ? note.trim().slice(0, 500) : '';
    const before = await ClientErrorType.findByIdAndUpdate(id, { $set: { state, stateAt: new Date(), stateBy: by, note: text || null } }).lean();
    if (!before) throw notFound('Type d’erreur introuvable.');
    return { before: before.state, after: state };
}
