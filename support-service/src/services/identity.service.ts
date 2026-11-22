import { FilterQuery, Types } from 'mongoose';
import { IIdentityVerification, IdentityVerification } from '../database/models/identity-verification.model';
import { Ticket } from '../database/models/ticket.model';
import { AgentRef } from '../database/models/approval.model';
import { badRequest, conflict, notFound } from '../utils/errors';
import { audit } from './audit.service';
import { decideL3, getL3, imageL3, KYC_KINDS, KycKind, KycL3Request, KycPurpose, submitL3 } from './clients/kyc.client';
import { getSupportMember } from './clients/user.client';
import { notifyAgents, notifyMember } from './notifier.service';
import { notifyManagers } from './ntfy.service';
import { assertInTeam, assertNoConflict, memberCountry, teamFilter } from './scope.service';
import { addSystemNote, createTicket, guestChatLink } from './ticket.service';
import { sendEmail } from './clients/notification.client';

/**
 * KYC level 3 (decided 2026-11-22): an ID document + selfie, asked when
 *   - the fraud engine holds the member (`fraud_hold`),
 *   - the member lost the phone with the authenticator (`authenticator_reset`),
 *   - someone says they lost their account details (`lost_access`; also from a guest request).
 * Any support agent reviews it (`identity.review`). The automatic checks on the secondary server
 * are hints. Images: deleted there 30 days after the decision; the decision is kept 12 months.
 * Approving proves identity, nothing more: the release, the reset or the contact change is still
 * its own request with its own approval.
 */

type Ctx = { ip?: string; userAgent?: string };
type Files = Partial<Record<KycKind, { buffer: Buffer; size: number }[]>>;

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MEMBER_PURPOSES: KycPurpose[] = ['fraud_hold', 'authenticator_reset', 'lost_access'];
const REASON_MIN = 10;

export const PURPOSE_LABELS: Record<KycPurpose, string> = {
    fraud_hold: 'Compte retenu par le contrôle anti-fraude',
    authenticator_reset: 'Téléphone de l’application d’authentification perdu',
    lost_access: 'Accès au compte perdu',
};
const PURPOSE_CATEGORY: Record<KycPurpose, string> = { fraud_hold: 'retrait', authenticator_reset: 'compte_acces', lost_access: 'compte_acces' };

/** The checks' codes, as the desk shows them. Hints, never a verdict. */
export const HINT_TEXT: Record<string, string> = {
    faces_differ: 'Le visage du selfie ne ressemble pas à la photo de la pièce.',
    selfie_no_face: 'Aucun visage trouvé sur le selfie.',
    selfie_several_faces: 'Plusieurs visages sur le selfie.',
    id_no_face: 'Aucun visage trouvé sur la pièce (recto).',
    face_seen_on_other_account: 'Le même visage a déjà été envoyé pour un autre compte.',
    image_reused: 'Une des photos a déjà été envoyée pour un autre compte.',
    id_front_blurry: 'Recto de la pièce flou.', id_back_blurry: 'Verso de la pièce flou.', selfie_blurry: 'Selfie flou.',
    id_front_dark: 'Recto trop sombre.', id_back_dark: 'Verso trop sombre.', selfie_dark: 'Selfie trop sombre.',
    id_front_overexposed: 'Recto trop clair (reflet ?).', id_back_overexposed: 'Verso trop clair.', selfie_overexposed: 'Selfie trop clair.',
    id_front_unreadable: 'Recto illisible.', id_back_unreadable: 'Verso illisible.', selfie_unreadable: 'Selfie illisible.',
    engine_unavailable: 'Contrôle automatique indisponible : vérifiez à l’œil.',
    face_compare_failed: 'La comparaison des visages a échoué : vérifiez à l’œil.',
    check_failed: 'Le contrôle automatique a échoué : vérifiez à l’œil.',
};

const JPEG = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const PNG = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const WEBP = (b: Buffer) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';

function imagesOf(files: Files | undefined): Partial<Record<KycKind, Buffer>> {
    const out: Partial<Record<KycKind, Buffer>> = {};
    for (const kind of KYC_KINDS) {
        const f = files?.[kind]?.[0];
        if (!f) continue;
        if (f.size > MAX_IMAGE_BYTES) throw badRequest('Une photo est trop lourde (4 Mo au plus).', 'IMAGE_TOO_LARGE');
        if (f.size < 1024 || !(JPEG(f.buffer) || PNG(f.buffer) || WEBP(f.buffer))) {
            throw badRequest('Envoyez des photos (JPEG, PNG ou WebP).', 'BAD_IMAGES');
        }
        out[kind] = f.buffer;
    }
    if (!out.id_front || !out.selfie) throw badRequest('Envoyez le recto de votre pièce d’identité et un selfie.', 'IMAGES_REQUIRED');
    return out;
}

const OPEN = ['pending', 'checked'];

async function assertNoneOpen(filter: FilterQuery<IIdentityVerification>) {
    if (await IdentityVerification.exists({ ...filter, status: { $in: OPEN } })) {
        throw conflict('Une vérification d’identité est déjà en cours. Attendez la réponse de l’équipe.', 'IDENTITY_PENDING');
    }
}

async function announce(v: { _id: unknown; purpose: KycPurpose; ticketId: Types.ObjectId | null }, ticketNumber: string | null) {
    const link = `/identites/${v._id}`;
    if (v.ticketId) {
        await addSystemNote(v.ticketId, `Pièce d’identité et selfie reçus (${PURPOSE_LABELS[v.purpose]}). À examiner dans « Identités ».`, true);
    }
    await notifyAgents({ role: 'support_agent', kind: 'identity.new', title: 'Vérification d’identité à examiner', body: `${PURPOSE_LABELS[v.purpose]}${ticketNumber ? ` (${ticketNumber})` : ''}`, link, dedupKey: `identity-new:${v._id}` });
    notifyManagers({ title: 'Vérification d’identité à examiner', message: `${PURPOSE_LABELS[v.purpose]}${ticketNumber ? `, ${ticketNumber}` : ''}`, priority: 3, click: link });
}

// ---------------------------------------------------------------- member / guest

export async function memberSubmit(userId: string, input: { purpose?: unknown; ticketId?: unknown }, files: Files | undefined) {
    const purpose = String(input.purpose ?? '') as KycPurpose;
    if (!MEMBER_PURPOSES.includes(purpose)) throw badRequest('Motif inconnu.', 'BAD_PURPOSE');
    const images = imagesOf(files);
    await assertNoneOpen({ memberId: userId });
    // The member's own open ticket, else a new one: the agent answers there.
    let ticket = null as null | { _id: Types.ObjectId; number: string };
    if (typeof input.ticketId === 'string' && Types.ObjectId.isValid(input.ticketId)) {
        ticket = await Ticket.findOne({ _id: input.ticketId, memberId: userId, status: { $ne: 'ferme' } }, { number: 1 }).lean();
    }
    const kycId = await submitL3({ ref: userId, purpose, images });
    const member = await getSupportMember(userId).catch(() => null);
    if (!ticket) {
        const t = await createTicket({
            memberId: userId, memberName: member?.name ?? null, category: PURPOSE_CATEGORY[purpose], subject: 'Vérification d’identité',
            body: `J’ai envoyé ma pièce d’identité et un selfie. Motif : ${PURPOSE_LABELS[purpose]}.`,
            source: 'member', author: { type: 'member', id: userId },
        });
        ticket = { _id: t._id as Types.ObjectId, number: t.number };
    }
    const v = await IdentityVerification.create({
        kycId, memberId: userId, ticketId: ticket._id, purpose, country: await memberCountry(userId), name: member?.name ?? null,
        images: Object.keys(images),
    });
    await audit({ actor: { type: 'member', id: userId }, action: 'identity.submitted', target: { type: 'identity', id: String(v._id) }, meta: { purpose, images: v.images } });
    await announce(v, ticket.number);
    return memberView(v.toObject());
}

export async function guestSubmit(ticketId: string, files: Files | undefined, ctx: Ctx) {
    const t = await Ticket.findOne({ _id: ticketId, memberId: null, status: { $ne: 'ferme' } }, { number: 1, contact: 1, country: 1 }).lean();
    if (!t) throw notFound('Demande introuvable ou fermée.');
    const images = imagesOf(files);
    await assertNoneOpen({ ticketId: t._id });
    const kycId = await submitL3({ ref: `guest:${t._id}`, purpose: 'lost_access', images });
    const v = await IdentityVerification.create({
        kycId, memberId: null, ticketId: t._id, purpose: 'lost_access', country: t.country ?? null, name: t.contact?.name ?? null, images: Object.keys(images),
    });
    await audit({ actor: { type: 'anonymous' }, action: 'identity.submitted', target: { type: 'identity', id: String(v._id) }, meta: { purpose: 'lost_access', ticket: t.number, images: v.images }, ip: ctx.ip, userAgent: ctx.userAgent });
    await announce(v, t.number);
    return memberView(v.toObject());
}

/** What the person sees: never the checks, never the agent. */
function memberView(v: IIdentityVerification & { _id: unknown }) {
    return {
        id: String(v._id), purpose: v.purpose, ticketId: v.ticketId ? String(v.ticketId) : null,
        status: v.status === 'checked' ? 'pending' : v.status, submittedAt: v.createdAt ?? null, decidedAt: v.decidedAt ?? null,
    };
}

export async function memberLatest(userId: string) {
    const v = await IdentityVerification.findOne({ memberId: userId }).sort({ createdAt: -1 }).lean();
    return v ? memberView(v) : null;
}

export async function guestLatest(ticketId: string) {
    const v = await IdentityVerification.findOne({ ticketId, memberId: null }).sort({ createdAt: -1 }).lean();
    return v ? memberView(v) : null;
}

// ---------------------------------------------------------------- desk

/** Brings the cached status, hints and score up to date from the secondary server (best effort for lists). */
async function refresh(rows: (IIdentityVerification & { _id: Types.ObjectId })[], strict: boolean): Promise<Record<string, KycL3Request>> {
    const want = rows.filter((r) => OPEN.includes(r.status) || !r.imagesDeletedAt).map((r) => r.kycId);
    let got: Record<string, KycL3Request> = {};
    try {
        got = await getL3(want);
    } catch (err) {
        if (strict) throw err;
        return {};
    }
    for (const r of rows) {
        const k = got[r.kycId];
        if (!k) continue;
        const set: Partial<IIdentityVerification> = {
            hints: k.scores?.hints ?? [], matchScore: k.scores?.match?.score ?? null,
            imagesDeletedAt: k.imagesDeletedAt ? new Date(k.imagesDeletedAt) : null,
        };
        if (OPEN.includes(r.status) && OPEN.includes(k.status)) set.status = k.status;
        if (set.status !== r.status || String(set.hints) !== String(r.hints) || set.matchScore !== r.matchScore || !!set.imagesDeletedAt !== !!r.imagesDeletedAt) {
            await IdentityVerification.updateOne({ _id: r._id }, { $set: set });
            Object.assign(r, set);
        }
    }
    return got;
}

const deskRow = (v: IIdentityVerification & { _id: unknown }) => ({
    id: String(v._id), memberId: v.memberId, ticketId: v.ticketId ? String(v.ticketId) : null, purpose: v.purpose, purposeLabel: PURPOSE_LABELS[v.purpose],
    status: v.status, country: v.country, name: v.name, guest: !v.memberId, images: v.images, matchScore: v.matchScore,
    hints: (v.hints ?? []).map((code) => ({ code, text: HINT_TEXT[code] ?? code })),
    submittedAt: v.createdAt, decidedAt: v.decidedAt ?? null, decidedBy: v.decidedBy ? { id: v.decidedBy.id, name: v.decidedBy.name } : null,
    decisionReason: v.decisionReason ?? null, imagesDeletedAt: v.imagesDeletedAt ?? null,
});

export async function deskList(q: Record<string, unknown>, team: string[] | undefined) {
    const filter: FilterQuery<IIdentityVerification> = { ...teamFilter(team) } as FilterQuery<IIdentityVerification>;
    if (q.status === 'open' || q.status === undefined) filter.status = { $in: OPEN };
    else if (['approved', 'refused'].includes(String(q.status))) filter.status = String(q.status);
    else if (q.status !== 'all') throw badRequest('Statut inconnu.', 'BAD_STATUS');
    if (typeof q.memberId === 'string' && /^[a-f0-9]{24}$/i.test(q.memberId)) filter.memberId = q.memberId;
    const limit = Math.min(100, Math.max(1, parseInt(String(q.limit ?? '50'), 10) || 50));
    const rows = await IdentityVerification.find(filter).sort({ createdAt: filter.status && (filter.status as any).$in ? 1 : -1 }).limit(limit).lean();
    await refresh(rows as any, false);
    return rows.map(deskRow);
}

async function loadForAgent(id: string, team: string[] | undefined) {
    if (!Types.ObjectId.isValid(id)) throw notFound('Vérification introuvable.');
    const v = await IdentityVerification.findById(id).lean();
    if (!v) throw notFound('Vérification introuvable.');
    assertInTeam(v.country, team, 'Vérification');
    return v;
}

export async function deskDetail(id: string, agent: AgentRef & { countries?: string[] }, ctx: Ctx) {
    const v = await loadForAgent(id, agent.countries);
    const got = await refresh([v as any], true);
    const k = got[v.kycId];
    const s = k?.scores ?? null;
    const others = (s?.sameFaceOtherPeople ?? []).map((o) => ({ score: o.score, memberId: /^[a-f0-9]{24}$/i.test(o.ref) ? o.ref : null, guest: o.ref.startsWith('guest:') }));
    await audit({ actor: { type: 'agent', ...agent }, action: 'identity.viewed', target: { type: 'identity', id }, ip: ctx.ip, userAgent: ctx.userAgent });
    return {
        ...deskRow(v as any),
        checks: s ? {
            engine: s.engine ?? null, match: s.match ?? null, images: s.images ?? {}, sameImageOtherPeople: s.sameImageOtherPeople ?? 0, sameFaceOtherPeople: others,
        } : null,
        imagesDeleteAt: k?.imagesDeleteAt ?? null,
    };
}

export async function deskImage(id: string, kind: unknown, agent: AgentRef & { countries?: string[] }, ctx: Ctx) {
    if (!KYC_KINDS.includes(kind as KycKind)) throw notFound('Image introuvable.');
    const v = await loadForAgent(id, agent.countries);
    const img = await imageL3(v.kycId, kind as KycKind);
    if (!img) throw notFound('Image introuvable (jamais envoyée, ou déjà supprimée).');
    // Every look at an identity document is on the record.
    await audit({ actor: { type: 'agent', ...agent }, action: 'identity.image.viewed', target: { type: 'identity', id }, meta: { kind }, ip: ctx.ip, userAgent: ctx.userAgent });
    return img;
}

export async function deskDecide(id: string, input: { decision?: unknown; reason?: unknown }, agent: AgentRef & { countries?: string[] }, ctx: Ctx) {
    const decision = input.decision === 'approved' || input.decision === 'refused' ? input.decision : null;
    if (!decision) throw badRequest('Décision inconnue (approved ou refused).', 'BAD_DECISION');
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 2000) : '';
    if (reason.length < REASON_MIN) throw badRequest(`Expliquez votre décision (${REASON_MIN} caractères au moins).`, 'REASON_REQUIRED');
    const v = await loadForAgent(id, agent.countries);
    if (!OPEN.includes(v.status)) throw conflict('Cette vérification a déjà été décidée.', 'ALREADY_DECIDED');
    await assertNoConflict(agent, v.memberId, { ...ctx, action: 'identity.decide' });
    // The secondary server takes the decision once; it also starts the 30-day countdown of the images.
    const done = await decideL3({ id: v.kycId, decision, by: agent.id, reason });
    if (!done) throw conflict('Cette vérification a déjà été décidée.', 'ALREADY_DECIDED');
    const now = new Date();
    const r = await IdentityVerification.updateOne({ _id: v._id, status: { $in: OPEN } }, {
        $set: { status: decision, decidedAt: now, decisionReason: reason, decidedBy: { id: agent.id, name: agent.name, roles: agent.roles } },
    });
    if (r.modifiedCount !== 1) throw conflict('Cette vérification a déjà été décidée.', 'ALREADY_DECIDED');
    await audit({ actor: { type: 'agent', ...agent }, action: `identity.${decision}`, target: { type: 'identity', id }, reason, meta: { purpose: v.purpose, memberId: v.memberId, hints: v.hints }, ip: ctx.ip, userAgent: ctx.userAgent });

    const ok = decision === 'approved';
    if (v.ticketId) {
        await addSystemNote(v.ticketId, `Vérification d’identité ${ok ? 'acceptée' : 'refusée'} par ${agent.name} : ${reason}`, true);
        await addSystemNote(v.ticketId, ok
            ? 'Votre identité a été vérifiée. Un agent poursuit le traitement de votre demande ici.'
            : 'Votre vérification d’identité n’a pas pu être acceptée. Un agent vous explique la suite ici ; vous pourrez envoyer de nouvelles photos nettes si besoin.', false);
    }
    if (!v.memberId && v.ticketId) {
        // A guest request: the person has no account to push to, only the email typed in the form.
        const t = await Ticket.findById(v.ticketId, { number: 1, contact: 1 }).lean();
        const link = await guestChatLink(String(v.ticketId));
        if (t?.contact?.email && link) {
            await sendEmail({
                recipient: t.contact.email, tag: `identity-${v._id}`, subject: `Votre demande ${t.number}`,
                body: `Bonjour${t.contact.name ? ` ${t.contact.name}` : ''},\n\n${ok ? 'Votre identité a été vérifiée.' : 'Votre vérification d’identité n’a pas pu être acceptée.'} `
                    + `Suivez la suite de votre demande ici : ${link}\n\nSBC ne vous demandera jamais votre mot de passe ni vos codes.`,
            });
        }
    }
    await notifyMember({
        userId: v.memberId, tag: `identity-${v._id}`, title: ok ? 'Identité vérifiée' : 'Vérification d’identité refusée',
        body: ok ? 'Votre identité a été vérifiée par l’équipe SBC.' : 'Votre vérification d’identité n’a pas pu être acceptée. Ouvrez l’espace Aide pour la suite.',
        path: v.ticketId ? `/aide/demandes/${v.ticketId}` : '/aide',
    });
    return deskDetail(id, agent, ctx);
}

/** For an authenticator reset or a release: the latest approved verification of this member, if any. */
export async function latestApproved(memberId: string) {
    const v = await IdentityVerification.findOne({ memberId, status: 'approved' }).sort({ decidedAt: -1 }).lean();
    return v ? { id: String(v._id), purpose: v.purpose, decidedAt: v.decidedAt, decidedBy: v.decidedBy?.name ?? null } : null;
}
