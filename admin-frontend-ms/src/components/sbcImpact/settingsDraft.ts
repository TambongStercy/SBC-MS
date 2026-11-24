import {
    fromLocalInput, toLocalInput,
    type Edition, type EditionSettings, type Prize, type UpdateEditionInput,
} from '../../services/impactV2Api';

/**
 * The « Règles et paramètres » form state: numbers are kept as typed (strings)
 * and converted on save; the save sends only what changed.
 */

export interface Draft {
    name: string;
    description: string;
    rulesText: string;
    qualificationOpensAt: string;
    qualificationClosesAt: string;
    competitionStartsAt: string;
    finalAt: string;
    maxCandidates: string;
    invitationsRequired: string;
    waitlistSize: string;
    finalistsCount: string;
    votePrice: string;
    prizeCooldownDays: string;
    showcaseMonths: string;
    paidVotes: string;
    publicVote: string;
    jury: string;
    votePacks: { votes: string; price: string }[];
    juryCriteria: { key: string; label: string; max: string }[];
    ticketTiers: { upTo: string; weight: string }[];
    prizes: Prize[];
    categories: string;
    profileFields: { key: string; label: string; required: boolean; maxLength: string }[];
}

const s = (n: number | null | undefined) => (n == null ? '' : String(n));
export const num = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')));

export function toDraft(e: Edition): Draft {
    const st = e.settings;
    return {
        name: e.name,
        description: e.description ?? '',
        rulesText: e.rulesText ?? '',
        qualificationOpensAt: toLocalInput(e.schedule.qualificationOpensAt),
        qualificationClosesAt: toLocalInput(e.schedule.qualificationClosesAt),
        competitionStartsAt: toLocalInput(e.schedule.competitionStartsAt),
        finalAt: toLocalInput(e.schedule.finalAt),
        maxCandidates: s(st.maxCandidates),
        invitationsRequired: s(st.invitationsRequired),
        waitlistSize: s(st.waitlistSize),
        finalistsCount: s(st.finalistsCount),
        votePrice: s(st.votePrice),
        prizeCooldownDays: s(st.prizeCooldownDays),
        showcaseMonths: s(st.showcaseMonths),
        paidVotes: s(st.weights?.paidVotes),
        publicVote: s(st.weights?.publicVote),
        jury: s(st.weights?.jury),
        votePacks: (st.votePacks ?? []).map(p => ({ votes: s(p.votes), price: s(p.price) })),
        juryCriteria: (st.juryCriteria ?? []).map(c => ({ key: c.key, label: c.label, max: s(c.max) })),
        ticketTiers: (st.ticketTiers ?? []).map(t => ({ upTo: s(t.upTo), weight: s(t.weight) })),
        prizes: (st.prizes ?? []).map(p => ({ key: p.key, label: p.label, category: p.category })),
        categories: (st.categories ?? []).join('\n'),
        profileFields: (st.profileFields ?? []).map(f => ({ key: f.key, label: f.label, required: !!f.required, maxLength: s(f.maxLength) })),
    };
}

/** What the draft would save, in the API's shape. */
export function fromDraft(d: Draft) {
    const settings: EditionSettings = {
        maxCandidates: num(d.maxCandidates),
        invitationsRequired: num(d.invitationsRequired),
        waitlistSize: num(d.waitlistSize),
        finalistsCount: num(d.finalistsCount),
        votePrice: num(d.votePrice),
        votePacks: d.votePacks.map(p => ({ votes: num(p.votes), price: num(p.price) })),
        weights: { paidVotes: num(d.paidVotes), publicVote: num(d.publicVote), jury: num(d.jury) },
        juryCriteria: d.juryCriteria.map(c => ({ key: c.key.trim(), label: c.label.trim(), max: num(c.max) })),
        // The last tier has no limit (the server sets it to null whatever is sent).
        ticketTiers: d.ticketTiers.map((t, i, all) => ({ upTo: i === all.length - 1 || t.upTo.trim() === '' ? null : num(t.upTo), weight: num(t.weight) })),
        prizes: d.prizes.map(p => ({ key: p.key.trim(), label: p.label.trim(), category: p.category.trim() })),
        prizeCooldownDays: num(d.prizeCooldownDays),
        showcaseMonths: num(d.showcaseMonths),
        categories: d.categories.split('\n').map(c => c.trim()).filter(Boolean),
        profileFields: d.profileFields.map(f => ({ key: f.key.trim(), label: f.label.trim(), required: f.required, maxLength: num(f.maxLength) })),
    };
    return {
        name: d.name.trim(),
        description: d.description,
        rulesText: d.rulesText,
        schedule: {
            qualificationOpensAt: fromLocalInput(d.qualificationOpensAt),
            qualificationClosesAt: fromLocalInput(d.qualificationClosesAt),
            competitionStartsAt: fromLocalInput(d.competitionStartsAt),
            finalAt: fromLocalInput(d.finalAt),
        },
        settings,
    };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Only what changed, so an unchanged locked rule is never sent (the server
 * refuses any locked field that differs, and compares whole values).
 */
export function diffEdition(original: Draft, draft: Draft): UpdateEditionInput {
    const a = fromDraft(original);
    const b = fromDraft(draft);
    const out: UpdateEditionInput = {};
    if (a.name !== b.name) out.name = b.name;
    if (a.description !== b.description) out.description = b.description;
    if (a.rulesText !== b.rulesText) out.rulesText = b.rulesText;
    const schedule: NonNullable<UpdateEditionInput['schedule']> = {};
    for (const k of Object.keys(b.schedule) as (keyof typeof b.schedule)[]) {
        if (a.schedule[k] !== b.schedule[k]) schedule[k] = b.schedule[k] || null;
    }
    if (Object.keys(schedule).length) out.schedule = schedule;
    const settings: Partial<EditionSettings> = {};
    for (const k of Object.keys(b.settings) as (keyof EditionSettings)[]) {
        if (!same(a.settings[k], b.settings[k])) (settings as Record<string, unknown>)[k] = b.settings[k];
    }
    if (Object.keys(settings).length) out.settings = settings;
    return out;
}
