import { Types } from 'mongoose';
import { AnimAuditLog } from '../models/governance.model';
import { AnimCtx, TeamRole } from '../types';
import logger from '../../../utils/logger';

const log = logger.getLogger('AnimationAudit');

const oid = (v?: string | Types.ObjectId | null) =>
    v && Types.ObjectId.isValid(String(v)) ? new Types.ObjectId(String(v)) : undefined;

/** Who performed an action, for the audit log. Jobs pass SYSTEM. */
export type Actor = Pick<AnimCtx, 'actorUserId' | 'role'> & Partial<Pick<AnimCtx, 'organizerId' | 'eventId' | 'ip'>>;

export const SYSTEM_ACTOR: Actor = { actorUserId: '', role: TeamRole.SYSTEM };

/**
 * Appends one entry (§37). Awaited after the state change it records; a failure
 * is logged loudly but never rolls the change back — losing an audit line is
 * bad, reverting a vote or a refund because logging failed would be worse.
 */
export const audit = async (args: {
    actor: Actor;
    action: string;
    targetType: string;
    targetId?: string | Types.ObjectId;
    organizerId?: string | Types.ObjectId;
    eventId?: string | Types.ObjectId;
    challengeId?: string | Types.ObjectId;
    before?: unknown;
    after?: unknown;
    reason?: string;
}) => {
    try {
        await AnimAuditLog.create({
            organizerId: oid(args.organizerId ?? args.actor.organizerId),
            eventId: oid(args.eventId ?? args.actor.eventId),
            challengeId: oid(args.challengeId),
            actorUserId: oid(args.actor.actorUserId) ?? null,
            actorRole: args.actor.role,
            action: args.action,
            targetType: args.targetType,
            targetId: args.targetId !== undefined ? String(args.targetId) : undefined,
            before: args.before,
            after: args.after,
            reason: args.reason,
            ip: args.actor.ip,
            at: new Date(),
        });
    } catch (err) {
        log.error(`AUDIT WRITE FAILED ${args.action} ${args.targetType}:${args.targetId} — ${(err as Error).message}`);
    }
};

/** Flattens a nested object to dotted paths: {voting:{mode:'X'}} → {'voting.mode':'X'}. Arrays are leaves. */
export const flatten = (obj: Record<string, any>, prefix = '', out: Record<string, unknown> = {}) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Types.ObjectId)) {
            flatten(v, path, out);
        } else {
            out[path] = v;
        }
    }
    return out;
};

const norm = (v: unknown): string => {
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Types.ObjectId) return String(v);
    if (Array.isArray(v)) return JSON.stringify(v.map((x) => norm(x)));
    if (v === undefined || v === null || v === '') return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

/** Paths of `patch` whose value differs from `current` (dates/ids compared by value). */
export const changedPaths = (current: Record<string, any>, patch: Record<string, any>) => {
    const flatCur = flatten(current);
    const flatPatch = flatten(patch);
    return Object.entries(flatPatch)
        .filter(([path, to]) => {
            const from = path in flatCur ? flatCur[path] : path.split('.').reduce<any>((o, k) => o?.[k], current);
            // Dates arrive as ISO strings from JSON.
            if (from instanceof Date && typeof to === 'string') return from.getTime() !== new Date(to).getTime();
            return norm(from) !== norm(to);
        })
        .map(([path, to]) => ({ path, from: path.split('.').reduce<any>((o, k) => o?.[k], current), to }));
};
