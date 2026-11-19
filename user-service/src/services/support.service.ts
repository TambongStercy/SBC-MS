import { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import ReferralModel from '../database/models/referral.model';
import SubscriptionModel from '../database/models/subscription.model';
import { notificationService, DeliveryChannel } from './clients/notification.service.client';
import { alertContactChange } from './contact-change-alert';
import { userService } from './user.service';
import { normalizePhoneNumber, phoneLookupCandidates, isSamePhoneNumber } from '../utils/phone.utils';
import { withdrawalLockFields } from '../utils/withdrawal-lock';
import { otpMatches, whatsappOtpEnabled } from '../utils/otp.utils';
import logger from '../utils/logger';

const log = logger.getLogger('SupportService');

/**
 * Owner side of SBC Support (docs/support/CONTRACT.md §2.1). support-service
 * calls these through /api/users/internal/* with the service secret. It
 * masks contact data per agent and enforces approvals; this file only
 * guarantees what leaves user-service and how a contact change is applied.
 */

export const SUPPORT_DETAILS_MAX_IDS = 100;
export const SUPPORT_SEARCH_MAX_LIMIT = 20;
const SUPPORT_CODE_MINUTES = 15;
const SUPPORT_CODE_COOLDOWN_MS = 60 * 1000;

/** Error with an HTTP status and a stable code for support-service. */
export class SupportError extends Error {
    constructor(public statusCode: number, public code: string, message: string) {
        super(message);
    }
}

/** Who asked, for the logs (contract §2 headers). */
export interface SupportCallContext {
    requestId?: string;
    actor?: string;
    caller?: string;
}
/**
 * Reads straight on the collection: the user model's soft-delete hook hides
 * deleted accounts from find(), and support must see them (and their email
 * and number still hold the unique indexes).
 */
const usersRaw = () => UserModel.collection;
const projectionOf = (fields: string) => Object.fromEntries(fields.split(' ').map(f => [f, 1]));

const ctx = (c: SupportCallContext) => `requestId=${c.requestId ?? '-'} actor=${c.actor ?? '-'} caller=${c.caller ?? '-'}`;

// ─── Member card ────────────────────────────────────────────────────────────

/**
 * The only user fields support may read. Listed explicitly (never an
 * exclusion list), so a field added to the user model later stays out until
 * someone adds it here. Never: password, otps, contactsOtps, otpSendLog,
 * token, passwordResetToken, IP data, adminPermissions.
 */
const SUPPORT_MEMBER_FIELDS = [
    'name', 'email', 'phoneNumber', 'country', 'city', 'sex', 'language', 'role', 'createdAt',
    'ipLastUpdated', 'isVerified', 'blocked', 'deleted',
    'balance', 'usdBalance', 'reservedBalance', 'debt', 'withdrawalsLockedUntil',
].join(' ');

export interface SupportMember {
    _id: string;
    name: string;
    email: string | null;
    phoneNumber: string | null;
    country: string | null;
    city: string | null;
    sex: string | null;
    language: string | null;
    role: string;
    createdAt: Date | null;
    /** Last authenticated activity (the user model has no login timestamp; this is `ipLastUpdated`). */
    lastLogin: Date | null;
    isVerified: boolean;
    blocked: boolean;
    deleted: boolean;
    referrerId: string | null;
    referrerName: string | null;
    balance: number;
    usdBalance: number;
    reservedBalance: number;
    debt: number;
    withdrawalLockedUntil: Date | null;
    subscriptions: { type: string; category: string | null; status: string; startDate: Date | null; endDate: Date | null }[];
}

export async function getSupportDetails(userIds: string[]): Promise<SupportMember[]> {
    const ids = userIds.map(id => new Types.ObjectId(id));
    const [users, referrals, subscriptions] = await Promise.all([
        usersRaw().find({ _id: { $in: ids } }, { projection: projectionOf(SUPPORT_MEMBER_FIELDS) }).toArray(),
        ReferralModel.find({ referredUser: { $in: ids }, referralLevel: 1 })
            .select('referrer referredUser archived createdAt').sort({ archived: 1, createdAt: -1 }).lean(),
        SubscriptionModel.find({ user: { $in: ids } })
            .select('user subscriptionType category status startDate endDate').sort({ startDate: -1 }).lean(),
    ]);

    // Direct parrain: the live (non-archived) level-1 referral first.
    const referrerOf = new Map<string, string>();
    for (const r of referrals as any[]) {
        const key = String(r.referredUser);
        if (!referrerOf.has(key) && r.referrer) referrerOf.set(key, String(r.referrer));
    }
    const referrerIds = Array.from(new Set(referrerOf.values()));
    const referrers = referrerIds.length
        ? await usersRaw().find({ _id: { $in: referrerIds.map(id => new Types.ObjectId(id)) } }, { projection: { name: 1 } }).toArray()
        : [];
    const referrerName = new Map((referrers as any[]).map(r => [String(r._id), r.name as string]));

    const subsOf = new Map<string, SupportMember['subscriptions']>();
    for (const s of subscriptions as any[]) {
        const key = String(s.user);
        if (!subsOf.has(key)) subsOf.set(key, []);
        subsOf.get(key)!.push({
            type: s.subscriptionType,
            category: s.category ?? null,
            status: s.status,
            startDate: s.startDate ?? null,
            endDate: s.endDate ?? null,
        });
    }

    const byId = new Map((users as any[]).map(u => [String(u._id), u]));
    const out: SupportMember[] = [];
    for (const id of userIds) {
        const u = byId.get(String(id));
        if (!u) continue;
        const refId = referrerOf.get(String(u._id)) ?? null;
        out.push({
            _id: String(u._id),
            name: u.name,
            email: u.email ?? null,
            phoneNumber: u.phoneNumber ?? null,
            country: u.country ?? null,
            city: u.city ?? null,
            sex: u.sex ?? null,
            language: Array.isArray(u.language) ? (u.language[0] ?? null) : (u.language ?? null),
            role: u.role,
            createdAt: u.createdAt ?? null,
            lastLogin: u.ipLastUpdated ?? null,
            isVerified: !!u.isVerified,
            blocked: !!u.blocked,
            deleted: !!u.deleted,
            referrerId: refId,
            referrerName: refId ? (referrerName.get(refId) ?? null) : null,
            balance: Number(u.balance ?? 0),
            usdBalance: Number(u.usdBalance ?? 0),
            // Added by the money branch (phase 2); absent until then.
            reservedBalance: Number(u.reservedBalance ?? 0),
            debt: Number(u.debt ?? 0),
            withdrawalLockedUntil: u.withdrawalsLockedUntil ?? null,
            subscriptions: subsOf.get(String(u._id)) ?? [],
        });
    }
    return out;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export interface SupportSearchHit { _id: string; name: string; country: string | null; role: string; createdAt: Date | null }

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What the typed text looks like: an id, an email, a phone number, or a name. */
export function classifySupportQuery(q: string): 'id' | 'email' | 'phone' | 'name' {
    if (/^[a-f\d]{24}$/i.test(q)) return 'id';
    if (q.includes('@')) return 'email';
    if (/^[\d\s+().-]+$/.test(q) && q.replace(/\D/g, '').length >= 8) return 'phone';
    return 'name';
}

/**
 * Exact `_id`, exact email (any case), phone in any format (same candidates
 * as password reset, `phoneLookupCandidates`), or name prefix (case
 * insensitive). Deleted accounts are included: support must be able to find
 * them. Several matches are normal here; the agent picks.
 */
export async function searchSupportMembers(rawQ: string, rawLimit?: number): Promise<SupportSearchHit[]> {
    const q = String(rawQ ?? '').trim().slice(0, 100);
    if (!q) return [];
    const limit = Math.min(Math.max(Number(rawLimit) || 10, 1), SUPPORT_SEARCH_MAX_LIMIT);
    let filter: Record<string, any>;
    switch (classifySupportQuery(q)) {
        case 'id':
            filter = { _id: new Types.ObjectId(q) };
            break;
        case 'email':
            filter = { email: q.toLowerCase() };
            break;
        case 'phone':
            filter = { phoneNumber: { $in: phoneLookupCandidates(q) } };
            break;
        default:
            if (q.length < 2) return [];
            filter = { name: { $regex: `^${escapeRegex(q)}`, $options: 'i' } };
    }
    const users = await usersRaw().find(filter, { projection: { name: 1, country: 1, role: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(limit).toArray();
    return (users as any[]).map(u => ({ _id: String(u._id), name: u.name, country: u.country ?? null, role: u.role, createdAt: u.createdAt ?? null }));
}

// ─── Contact change (member without access to the account) ─────────────────

export type SupportContactField = 'email' | 'phoneNumber';
const PURPOSE: Record<SupportContactField, 'supportChangeEmail' | 'supportChangePhone'> = {
    email: 'supportChangeEmail',
    phoneNumber: 'supportChangePhone',
};

/** Neutral on purpose (REC-10): never says which account holds the value. */
const CONTACT_UNAVAILABLE = () => new SupportError(400, 'CONTACT_UNAVAILABLE', 'Ce contact ne peut pas être utilisé pour ce compte.');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function loadTarget(userId: string) {
    const user = await UserModel.findById(userId).select('name email phoneNumber country language deleted otps');
    if (!user) throw new SupportError(404, 'USER_NOT_FOUND', 'Membre introuvable.');
    if (user.deleted) throw new SupportError(400, 'ACCOUNT_DELETED', 'Ce compte est supprimé.');
    return user;
}

/** The new value in its stored form, or a 400. */
function normalizeNewValue(field: SupportContactField, raw: unknown, country?: string | null): string {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (field === 'email') {
        const email = value.toLowerCase();
        if (!EMAIL_RE.test(email) || email.length > 200) throw new SupportError(400, 'INVALID_VALUE', 'Adresse e-mail invalide.');
        return email;
    }
    const phone = normalizePhoneNumber(value, country);
    if (!phone || phone.length < 8) throw new SupportError(400, 'INVALID_VALUE', 'Numéro de téléphone invalide.');
    return phone;
}

async function assertAvailable(field: SupportContactField, value: string, userId: string) {
    // Deleted accounts included: their values still hold the unique indexes.
    const filter: Record<string, any> = field === 'email'
        ? { email: value }
        : { phoneNumber: { $in: Array.from(new Set([value, ...phoneLookupCandidates(value)])) } };
    const other = await usersRaw().findOne({ ...filter, _id: { $ne: new Types.ObjectId(userId) } }, { projection: { _id: 1 } });
    if (other) throw CONTACT_UNAVAILABLE();
}

function isSameValue(field: SupportContactField, current: string | undefined | null, next: string) {
    return field === 'email' ? (current ?? '').toLowerCase() === next : isSamePhoneNumber(current, next);
}

export interface ContactChangeInput {
    userId: string;
    field: SupportContactField;
    newValue: string;
    step: 'send-code' | 'apply';
    code?: string;
    approvalId: string;
}

/**
 * `send-code`: a code bound to this change (purpose supportChange*, target =
 * new value) goes to the NEW contact, never to the old one, which the member
 * may have lost or which may be the attacker's. `apply`: checks that code,
 * then changes the contact in one conditional write (the old value must still
 * be in place), locks withdrawals (`withdrawalLockFields`) and alerts the
 * OLD email (`alertContactChange`). Approval itself is enforced by
 * support-service; `approvalId` is required here so every change is traceable.
 */
export async function supportContactChange(input: ContactChangeInput, c: SupportCallContext = {}) {
    const { userId, field, step, approvalId } = input;
    const user = await loadTarget(userId);
    const newValue = normalizeNewValue(field, input.newValue, user.country);
    const current = field === 'email' ? user.email : user.phoneNumber;
    if (isSameValue(field, current, newValue)) {
        throw new SupportError(400, 'SAME_VALUE', 'C’est déjà le contact de ce compte.');
    }
    await assertAvailable(field, newValue, userId);
    const purpose = PURPOSE[field];
    const tail = field === 'email' ? newValue.replace(/^(.{2}).*(@.*)$/, '$1•••$2') : `•••${newValue.slice(-3)}`;

    if (step === 'send-code') {
        const channel = field === 'email' ? DeliveryChannel.EMAIL : DeliveryChannel.WHATSAPP;
        if (channel === DeliveryChannel.WHATSAPP && !whatsappOtpEnabled()) {
            // The only way to reach a new number is WhatsApp; falling back to the
            // account email would prove nothing about the number.
            throw new SupportError(503, 'CHANNEL_UNAVAILABLE', 'Impossible d’envoyer un code au nouveau numéro pour le moment.');
        }
        const now = Date.now();
        const recent = (user.otps || []).some(o => o.purpose === purpose
            && new Date(o.expiration).getTime() - SUPPORT_CODE_MINUTES * 60 * 1000 > now - SUPPORT_CODE_COOLDOWN_MS);
        if (recent) throw new SupportError(429, 'CODE_COOLDOWN', 'Un code vient d’être envoyé. Patientez une minute.');

        const code = await userService.generateAndStoreOtp(user._id, 'otps', SUPPORT_CODE_MINUTES, { purpose, target: newValue });
        const queued = await notificationService.sendOtp({
            userId: String(user._id),
            recipient: newValue,
            channel,
            code,
            expireMinutes: SUPPORT_CODE_MINUTES,
            isRegistration: false,
            purpose: field === 'email' ? 'changeEmail' : 'changePhone',
            userName: user.name,
            language: (user.language as any)?.[0] || 'fr',
        });
        log.info(`Support contact-change code for user ${userId} field=${field} to ${tail} approvalId=${approvalId} queued=${queued} ${ctx(c)}`);
        if (!queued) throw new SupportError(502, 'DELIVERY_FAILED', 'Le code n’a pas pu être envoyé. Réessayez.');
        return { step, sent: true, expiresInMinutes: SUPPORT_CODE_MINUTES };
    }

    // apply
    const typed = typeof input.code === 'string' ? input.code.trim() : '';
    const now = new Date();
    const match = typed && (user.otps || []).find(o => o.purpose === purpose && o.target === newValue
        && otpMatches(o.code, typed) && new Date(o.expiration) > now);
    if (!match) {
        log.warn(`Support contact-change refused (bad or expired code) user ${userId} field=${field} approvalId=${approvalId} ${ctx(c)}`);
        throw new SupportError(400, 'INVALID_CODE', 'Code invalide ou expiré.');
    }

    const reason = field === 'email' ? 'email_change' : 'phone_change';
    const lock = withdrawalLockFields(reason);
    let result;
    try {
        result = await UserModel.updateOne(
            { _id: user._id, [field]: current, deleted: { $ne: true } },
            // Every code goes: sign-in codes were sent to the old contact.
            { $set: { [field]: newValue, ...lock, otps: [] } },
        );
    } catch (err: any) {
        if (err?.code === 11000) throw CONTACT_UNAVAILABLE();
        throw err;
    }
    if (result.modifiedCount !== 1) {
        throw new SupportError(409, 'STATE_CHANGED', 'Le compte a changé entre-temps. Recommencez.');
    }
    alertContactChange({ userId: user._id, previousEmail: user.email, reason, newValue });
    log.warn(`Support contact-change APPLIED user ${userId} field=${field} to ${tail} approvalId=${approvalId} lockedUntil=${lock.withdrawalsLockedUntil.toISOString()} ${ctx(c)}`);
    return { step, applied: true, withdrawalLockedUntil: lock.withdrawalsLockedUntil };
}
