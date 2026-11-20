import { Schema, model } from 'mongoose';

/**
 * Append-only, hash-chained audit log. There is no update or delete path in
 * this service: the hooks below refuse them, and the Mongo user of the
 * service should hold no update/remove right on this collection.
 */
export interface IAuditLog {
    seq: number;
    at: Date;
    actor: { type: 'agent' | 'system' | 'service' | 'member' | 'anonymous'; id?: string | null; name?: string | null; roles?: string[] };
    action: string;
    result: 'ok' | 'denied' | 'error';
    target?: { type?: string | null; id?: string | null } | null;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    meta?: unknown;
    ip?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
    prevHash: string;
    hash: string;
}

const AuditLogSchema = new Schema<IAuditLog>({
    seq: { type: Number, required: true, unique: true },
    at: { type: Date, required: true },
    actor: { type: Schema.Types.Mixed, required: true },
    action: { type: String, required: true, index: true },
    result: { type: String, required: true },
    target: { type: Schema.Types.Mixed, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    reason: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    requestId: { type: String, default: null },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
}, { versionKey: false, minimize: false });

AuditLogSchema.index({ 'actor.id': 1, at: -1 });
AuditLogSchema.index({ 'target.id': 1, at: -1 });
AuditLogSchema.index({ at: -1 });

const refuse = function () { throw new Error('auditlogs is append-only'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
    'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
    AuditLogSchema.pre(op as any, refuse);
}
AuditLogSchema.pre('save', function (next) {
    if (!this.isNew) return next(new Error('auditlogs is append-only'));
    next();
});

export const AuditLog = model<IAuditLog>('AuditLog', AuditLogSchema, 'auditlogs');
