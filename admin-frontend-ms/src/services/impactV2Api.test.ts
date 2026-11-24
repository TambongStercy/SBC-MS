import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import {
    actorLabel, fieldLabel, fromLocalInput, impactErrorMessage, lockReason, photoUrl, readImpactError, toLocalInput, type Edition,
} from './impactV2Api';
import { diffEdition, toDraft } from '../components/sbcImpact/settingsDraft';

const httpError = (status: number, data: unknown) =>
    new AxiosError('Request failed with status code ' + status, 'ERR_BAD_REQUEST', undefined, undefined, { status, data } as AxiosResponse);

describe('readImpactError / impactErrorMessage', () => {
    it('shows the backend’s French message, code and field', () => {
        const err = httpError(400, { success: false, message: 'La pondération finale doit faire 100 % au total.', code: 'INVALID_SETTINGS', details: { field: 'weights' } });
        expect(readImpactError(err)).toEqual({
            message: 'La pondération finale doit faire 100 % au total.', code: 'INVALID_SETTINGS', status: 400, fields: ['weights'],
        });
        expect(impactErrorMessage(err)).toBe('La pondération finale doit faire 100 % au total.');
    });

    it('lists the locked fields of RULES_LOCKED in words', () => {
        const err = httpError(409, {
            success: false, message: 'Ces règles sont verrouillées pour cette édition.', code: 'RULES_LOCKED',
            details: { fields: ['settings.maxCandidates', 'schedule.qualificationClosesAt', 'rulesText'] },
        });
        expect(readImpactError(err).fields).toEqual(['settings.maxCandidates', 'schedule.qualificationClosesAt', 'rulesText']);
        expect(impactErrorMessage(err)).toBe(
            'Ces règles sont verrouillées pour cette édition. (nombre de candidats, fin de la qualification, règlement)',
        );
    });

    it('reads INVALID_SCHEDULE’s `schedule.<key>` field', () => {
        const err = httpError(400, { success: false, message: 'La finale a lieu après le début de la compétition.', code: 'INVALID_SCHEDULE', details: { field: 'schedule.finalAt' } });
        expect(readImpactError(err).fields).toEqual(['schedule.finalAt']);
        expect(fieldLabel('schedule.finalAt')).toBe('finale');
    });

    it('keeps STALE as a code the sheet can act on', () => {
        const err = httpError(409, { success: false, message: 'Le profil a été modifié depuis votre lecture. Rechargez-le avant de décider.', code: 'STALE' });
        expect(readImpactError(err).code).toBe('STALE');
    });

    it('falls back when the server sent no message, or did not answer', () => {
        expect(impactErrorMessage(httpError(500, ''), 'Le recomptage a échoué.')).toBe('Le recomptage a échoué.');
        const network = new AxiosError('Network Error', 'ERR_NETWORK');
        expect(impactErrorMessage(network, 'x')).toMatch(/ne répond pas/);
        expect(impactErrorMessage(new Error('Impossible de charger le journal.'))).toBe('Impossible de charger le journal.');
    });
});

describe('actorLabel', () => {
    it('names the admin when known, else the role', () => {
        expect(actorLabel({ actorRole: 'admin', actorName: 'Rufus' })).toBe('Rufus');
        expect(actorLabel({ actorRole: 'admin', actorName: null })).toBe('Administration');
        expect(actorLabel({ actorRole: 'system' })).toBe('Système');
    });
});

describe('lockReason (PHASE1.md « Locks »)', () => {
    it('leaves everything open in DRAFT', () => {
        for (const f of ['rulesText', 'qualificationClosesAt', 'maxCandidates', 'profileFields', 'votePrice', 'competitionStartsAt'] as const) {
            expect(lockReason('DRAFT', f)).toBeNull();
        }
    });

    it('freezes the rules and qualification settings once qualification opens', () => {
        expect(lockReason('QUALIFICATION', 'rulesText')).toMatch(/ouverture de la qualification/);
        expect(lockReason('QUALIFICATION', 'qualificationOpensAt')).not.toBeNull();
        expect(lockReason('QUALIFICATION_CLOSED', 'categories')).not.toBeNull();
        // competition rules stay open until the competition starts
        expect(lockReason('QUALIFICATION', 'votePrice')).toBeNull();
        expect(lockReason('QUALIFICATION_CLOSED', 'weights')).toBeNull();
        expect(lockReason('QUALIFICATION', 'competitionStartsAt')).toBeNull();
    });

    it('freezes the competition rules from COMPETITION on', () => {
        expect(lockReason('COMPETITION', 'votePacks')).toMatch(/début de la compétition/);
        expect(lockReason('FINAL', 'competitionStartsAt')).not.toBeNull();
    });

    it('closes everything when the edition is over', () => {
        expect(lockReason('CANCELLED', 'votePrice')).toMatch(/terminée/);
        expect(lockReason('FINISHED', 'rulesText')).toMatch(/terminée/);
    });
});

describe('datetime-local ⇄ ISO', () => {
    it('reads the input as local time and comes back to the same input', () => {
        const iso = fromLocalInput('2026-12-01T09:30');
        expect(new Date(iso).getHours()).toBe(9);
        expect(new Date(iso).getMinutes()).toBe(30);
        expect(toLocalInput(iso)).toBe('2026-12-01T09:30');
    });

    it('keeps empty values empty', () => {
        expect(fromLocalInput('')).toBe('');
        expect(toLocalInput(null)).toBe('');
        expect(toLocalInput('not a date')).toBe('');
    });
});

describe('photoUrl', () => {
    it('goes through the settings file proxy, resized when asked', () => {
        expect(photoUrl('impact/photo 1.jpg', 160)).toMatch(/\/settings\/files\/impact%2Fphoto%201\.jpg\?w=160$/);
        expect(photoUrl('a.jpg')).not.toContain('?w=');
        expect(photoUrl('')).toBe('');
    });
});

const edition: Edition = {
    _id: 'e1', name: 'Édition 1', slug: 'edition-1', description: '', rulesText: 'Règlement',
    status: 'QUALIFICATION', statusHistory: [],
    schedule: { qualificationOpensAt: '2026-12-01T08:00:00.000Z', qualificationClosesAt: '2026-12-20T18:00:30.123Z' },
    settings: {
        maxCandidates: 20, invitationsRequired: 10, waitlistSize: 5, finalistsCount: 3, votePrice: 200,
        votePacks: [{ votes: 1, price: 200 }, { votes: 5, price: 1000 }],
        weights: { paidVotes: 50, publicVote: 30, jury: 20 },
        juryCriteria: [{ key: 'impact', label: 'Impact', max: 10 }],
        ticketTiers: [{ upTo: 10, weight: 1 }, { upTo: null, weight: 0.25 }],
        prizes: [{ key: 'cash', label: 'Prix en espèces', category: 'cash' }],
        prizeCooldownDays: 365, showcaseMonths: 12,
        categories: ['Commerce', 'Services'],
        profileFields: [],
    },
    seatSeq: 0, waitlistSeq: 0, createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z',
};

describe('diffEdition (the save sends only what changed)', () => {
    it('sends nothing when nothing changed (seconds in a stored date included)', () => {
        const d = toDraft(edition);
        expect(diffEdition(d, { ...d })).toEqual({});
    });

    it('sends a changed prize without the unchanged locked rules', () => {
        const d = toDraft(edition);
        const next = { ...d, prizes: [...d.prizes, { key: 'tel', label: 'Un téléphone', category: 'telephone' }] };
        expect(diffEdition(d, next)).toEqual({
            settings: { prizes: [{ key: 'cash', label: 'Prix en espèces', category: 'cash' }, { key: 'tel', label: 'Un téléphone', category: 'telephone' }] },
        });
    });

    it('sends numbers as numbers, categories one per line, and a cleared date as null', () => {
        const withFinal = toDraft({ ...edition, schedule: { ...edition.schedule, finalAt: '2027-01-10T18:00:00.000Z' } });
        const changes = diffEdition(withFinal, { ...withFinal, votePrice: '250', categories: 'Commerce\n\n Services \nArtisanat', finalAt: '' });
        expect(changes).toEqual({
            schedule: { finalAt: null },
            settings: { votePrice: 250, categories: ['Commerce', 'Services', 'Artisanat'] },
        });
    });

    it('keeps the last ticket tier without limit', () => {
        const d = toDraft(edition);
        const changes = diffEdition(d, { ...d, ticketTiers: [{ upTo: '10', weight: '1' }, { upTo: '', weight: '0.5' }] });
        expect(changes.settings?.ticketTiers).toEqual([{ upTo: 10, weight: 1 }, { upTo: null, weight: 0.5 }]);
    });
});
