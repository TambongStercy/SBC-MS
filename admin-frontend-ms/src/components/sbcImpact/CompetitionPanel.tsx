import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Button, Field, Input, Panel, PanelBody, PanelHeader } from '../ui';
import { ConfirmDialog, DetailList, Notice, formatDateTime, type ConfirmOptions } from '../moduleKit';
import { cn } from '../../lib/cn';
import {
    ROUND_LABELS, ROUND_STAGE, STAGE_LABELS, advanceStage, closeRoundNow, fromLocalInput, impactErrorMessage, launchCompetition,
    openRoundNow, readImpactError, scheduleRound, toLocalInput, type Edition, type Round, type RoundKey, type Stage,
} from '../../services/impactV2Api';
import { RoundStatusBadge } from './shared';

const STEPS: { stage: Stage; label: string }[] = [
    { stage: 'WEEK1', label: 'Semaine 1' },
    { stage: 'WEEK2', label: 'Semaine 2' },
    { stage: 'WEEK3', label: 'Semaine 3' },
    { stage: 'TOP3', label: 'TOP 3' },
];

/** Semaine 1 → 2 → 3 → TOP 3, the current one highlighted. */
function Stepper({ stage }: { stage: Stage | null | undefined }) {
    const current = stage ? STEPS.findIndex(s => s.stage === stage) : -1;
    return (
        <ol className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Étapes de la compétition">
            {STEPS.map((s, i) => {
                const done = i < current;
                const on = i === current;
                return (
                    <li key={s.stage} className="flex items-center gap-1.5" aria-current={on ? 'step' : undefined}>
                        <span className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium',
                            on ? 'bg-primary text-primary-fg' : done ? 'bg-success-soft text-success' : 'bg-surface-2 text-fg-muted',
                        )}>
                            {done && <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden="true" />}
                            {s.label}
                        </span>
                        {i < STEPS.length - 1 && <HugeiconsIcon icon={ArrowRight01Icon} size={14} className="text-fg-subtle" aria-hidden="true" />}
                    </li>
                );
            })}
        </ol>
    );
}

const roundOf = (e: Edition, k: RoundKey): Round => e.rounds?.[k] ?? { status: 'SCHEDULED' };

/** One vote round: its dates (editable while scheduled), open now, close now. */
function RoundCard({ edition, k, canWrite, onChanged, ask }: {
    edition: Edition;
    k: RoundKey;
    canWrite: boolean;
    onChanged: (e?: Edition) => void;
    ask: (o: ConfirmOptions) => void;
}) {
    const r = roundOf(edition, k);
    const savedOpens = toLocalInput(r.opensAt);
    const savedCloses = toLocalInput(r.closesAt);
    const [opensAt, setOpensAt] = useState(savedOpens);
    const [closesAt, setClosesAt] = useState(savedCloses);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
    useEffect(() => { setOpensAt(savedOpens); setClosesAt(savedCloses); }, [savedOpens, savedCloses]);

    const week = ROUND_STAGE[k] === 'WEEK2' ? 'semaine 2' : 'semaine 3';
    const editionOpen = edition.status !== 'FINAL' && edition.status !== 'FINISHED' && edition.status !== 'CANCELLED';
    const scheduled = r.status === 'SCHEDULED';
    const dirty = opensAt !== savedOpens || closesAt !== savedCloses;
    const inItsWeek = edition.status === 'COMPETITION' && edition.stage === ROUND_STAGE[k];
    const endPassed = !!r.closesAt && new Date(r.closesAt).getTime() <= Date.now();

    const save = async () => {
        if (!opensAt || !closesAt) { setError({ field: null, message: 'Indiquez l’ouverture et la fin du vote.' }); return; }
        if (closesAt <= opensAt) { setError({ field: 'closesAt', message: 'Le vote doit se terminer après son ouverture.' }); return; }
        setSaving(true);
        setError(null);
        try {
            const e = await scheduleRound(edition._id, k, { opensAt: fromLocalInput(opensAt), closesAt: fromLocalInput(closesAt) });
            toast.success(`${ROUND_LABELS[k]} : dates enregistrées.`);
            onChanged(e);
        } catch (err) {
            const x = readImpactError(err, 'Les dates du vote n’ont pas pu être enregistrées.');
            setError({ field: x.fields[0]?.split('.').pop() ?? null, message: x.message });
        } finally {
            setSaving(false);
        }
    };

    const askOpen = () => ask({
        title: `Ouvrir le ${ROUND_LABELS[k].toLowerCase()} maintenant ?`,
        tone: 'primary',
        confirmLabel: 'Ouvrir maintenant',
        description: `Les membres peuvent voter tout de suite, jusqu’au ${formatDateTime(r.closesAt)}. Les candidats en course sont prévenus.`,
        onConfirm: async () => {
            try {
                onChanged(await openRoundNow(edition._id, k));
                toast.success(`${ROUND_LABELS[k]} ouvert.`);
            } catch (err) {
                const x = readImpactError(err, 'Le vote n’a pas pu être ouvert.');
                // The end date has passed: point at it in the form.
                if (x.code === 'INVALID_SCHEDULE') {
                    setError({ field: x.fields[0]?.split('.').pop() ?? 'closesAt', message: x.message });
                    toast.error(x.message);
                    return;
                }
                // Opened or closed meanwhile (the job, another admin): show the round as it is.
                if (x.code === 'ROUND_STARTED') {
                    toast.error(x.message);
                    onChanged();
                    return;
                }
                throw new Error(x.message);
            }
        },
    });
    const askClose = () => ask({
        title: `Clore le ${ROUND_LABELS[k].toLowerCase()} maintenant ?`,
        confirmLabel: 'Clore le vote',
        description: `Plus aucun vote n’est accepté à partir de maintenant, au lieu du ${formatDateTime(r.closesAt)}. Un vote clos ne se rouvre jamais.`
            + (k === 'PAID' ? ' Les paiements lancés avant la clôture comptent encore s’ils sont confirmés dans le délai prévu.' : ''),
        reason: { label: 'Raison', required: true, minLength: 5 },
        onConfirm: async (reason: string) => {
            try {
                onChanged(await closeRoundNow(edition._id, k, reason));
                toast.success(`${ROUND_LABELS[k]} clos.`);
            } catch (err) {
                throw new Error(impactErrorMessage(err, 'Le vote n’a pas pu être clos.'));
            }
        },
    });

    const fieldError = (f: 'opensAt' | 'closesAt') => (error && (error.field === f || (!error.field && f === 'closesAt')) ? error.message : undefined);

    return (
        <div className="space-y-3 rounded-panel border border-line p-4" data-testid={`round-${k}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <p className="font-medium text-fg">{ROUND_LABELS[k]}</p>
                    <p className="text-xs text-fg-muted">{k === 'FREE' ? '1 compte = 1 vote' : 'Packs payants'}, en {week}</p>
                </div>
                <RoundStatusBadge status={r.status} />
            </div>

            <DetailList items={[
                ['Ouverture prévue', r.opensAt ? formatDateTime(r.opensAt) : '—'],
                ['Fin prévue', r.closesAt ? formatDateTime(r.closesAt) : '—'],
                r.openedAt ? ['Ouvert le', formatDateTime(r.openedAt)] : null,
                r.closedAt ? ['Clos le', formatDateTime(r.closedAt)] : null,
            ]} />

            {scheduled && canWrite && editionOpen && (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Ouverture" error={fieldError('opensAt')}>
                            <Input type="datetime-local" className="h-11 sm:h-9" value={opensAt} onChange={e => setOpensAt(e.target.value)} />
                        </Field>
                        <Field label="Fin" error={fieldError('closesAt')}>
                            <Input type="datetime-local" className="h-11 sm:h-9" value={closesAt} onChange={e => setClosesAt(e.target.value)} />
                        </Field>
                    </div>
                    <p className="text-xs text-fg-muted">Heures de votre appareil. Le vote s’ouvre tout seul à sa date pendant la {week}, et se clôt tout seul à sa fin.</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button variant="outline" size="lg" onClick={() => void save()} loading={saving} disabled={!dirty}>Enregistrer les dates</Button>
                        {inItsWeek && (
                            <Button variant="primary" size="lg" onClick={askOpen} disabled={dirty || !r.closesAt || endPassed}
                                title={dirty ? 'Enregistrez d’abord les dates.' : !r.closesAt ? 'Enregistrez d’abord la fin du vote.' : undefined}>
                                Ouvrir maintenant
                            </Button>
                        )}
                    </div>
                    {inItsWeek && (!r.closesAt || endPassed) && (
                        <p className="text-xs text-fg-muted">Pour ouvrir maintenant, enregistrez d’abord une date de fin à venir.</p>
                    )}
                </div>
            )}

            {r.status === 'OPEN' && canWrite && (
                <Button variant="danger-ghost" size="lg" onClick={askClose}>Clore maintenant</Button>
            )}
        </div>
    );
}

type LaunchBlock = { code: string; message: string; candidates: { _id: string; name: string }[] };

/**
 * The competition, driven by the edition's status and stage: the steps, the
 * launch and the move to the next week, and the two vote rounds.
 */
export default function CompetitionPanel({ edition, canWrite, onChanged, onOpenCandidate, onShowCandidates, onShowTop3 }: {
    edition: Edition;
    canWrite: boolean;
    /** The answer of an action (the page stores it and reloads the rest); nothing = just reload. */
    onChanged: (e?: Edition) => void;
    onOpenCandidate: (id: string) => void;
    onShowCandidates: (filter: Record<string, string>) => void;
    onShowTop3: () => void;
}) {
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
    const [block, setBlock] = useState<LaunchBlock | null>(null);
    const e = edition;
    const free = roundOf(e, 'FREE');

    const askLaunch = () => setConfirm({
        title: 'Lancer la compétition ?',
        tone: 'primary',
        confirmLabel: 'Lancer la compétition',
        description: 'Les profils des candidats officiels sont publiés à tous les membres (et peuvent être repris sur les réseaux de SBC). La liste d’attente passe « Inscriptions fermées ». La semaine 1 commence.',
        body: <Notice tone="warning">Chaque profil officiel doit être validé, et aucun candidat ne doit être suspendu.</Notice>,
        onConfirm: async () => {
            setBlock(null);
            try {
                onChanged(await launchCompetition(e._id));
                toast.success('La compétition est lancée : semaine 1.');
            } catch (err) {
                const x = readImpactError(err, 'La compétition n’a pas pu être lancée.');
                if (x.code === 'PROFILES_TO_REVIEW' || x.code === 'NOT_ENOUGH_CANDIDATES' || x.code === 'SUSPENDED_CANDIDATES') {
                    const candidates = Array.isArray(x.details?.candidates) ? (x.details!.candidates as { _id: string; name: string }[]) : [];
                    setBlock({ code: x.code, message: x.message, candidates });
                    toast.error(x.message);
                    return;
                }
                throw new Error(x.message);
            }
        },
    });

    const askAdvance = () => {
        const toWeek3 = e.stage === 'WEEK2';
        setConfirm({
            title: toWeek3 ? 'Passer à la semaine 3 ?' : 'Passer à la semaine 2 ?',
            tone: 'primary',
            confirmLabel: toWeek3 ? 'Passer à la semaine 3' : 'Passer à la semaine 2',
            description: toWeek3
                ? 'Les candidats passent « Étape 3 » et sont invités à présenter leur projet. Les votes payants portent sur les projets publiés.'
                : 'Les candidats passent « Étape 2 » et sont invités à déposer leur vidéo « Ma vision de SBC ». Le vote gratuit porte sur les vidéos publiées.',
            body: toWeek3 && free.status === 'SCHEDULED'
                ? <Notice tone="warning">Le vote gratuit n’a pas eu lieu : il ne pourra plus s’ouvrir après ce passage.</Notice>
                : undefined,
            onConfirm: async () => {
                try {
                    onChanged(await advanceStage(e._id));
                    toast.success(toWeek3 ? 'Semaine 3 commencée.' : 'Semaine 2 commencée.');
                } catch (err) {
                    throw new Error(impactErrorMessage(err, 'L’étape suivante n’a pas pu commencer.'));
                }
            },
        });
    };

    const freeOpen = free.status === 'OPEN';
    const action = !canWrite ? null
        : e.status === 'QUALIFICATION_CLOSED' && !e.stage
            ? <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={askLaunch}>Lancer la compétition</Button>
            : e.status === 'COMPETITION' && e.stage === 'WEEK1'
                ? <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={askAdvance}>Passer à la semaine 2</Button>
                : e.status === 'COMPETITION' && e.stage === 'WEEK2'
                    ? <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={askAdvance} disabled={freeOpen}
                        title={freeOpen ? 'Clôturez d’abord le vote gratuit.' : undefined}>Passer à la semaine 3</Button>
                    : e.status === 'COMPETITION' && e.stage === 'WEEK3'
                        ? <Button variant="outline" size="lg" className="w-full sm:w-auto" onClick={onShowTop3}>Voir le classement du TOP 3</Button>
                        : null;

    return (
        <Panel>
            <PanelHeader
                title="Compétition"
                description={e.stage ? STAGE_LABELS[e.stage] : e.status === 'QUALIFICATION_CLOSED' ? 'Prête à être lancée.' : 'Commence une fois la qualification terminée.'}
                actions={<div className="hidden sm:block">{action}</div>}
            />
            <PanelBody className="space-y-4">
                <Stepper stage={e.stage} />
                {action && <div className="sm:hidden">{action}</div>}
                {freeOpen && e.stage === 'WEEK2' && canWrite && (
                    <p className="text-xs text-fg-muted">Clôturez d’abord le vote gratuit pour passer à la semaine 3.</p>
                )}
                {e.stage === 'WEEK3' && (
                    <p className="text-sm text-fg-muted">La semaine 3 se termine par la désignation du TOP 3, une fois les votes payants clos.</p>
                )}

                {block && (
                    <Notice tone="danger">
                        <p>{block.message}</p>
                        {block.candidates.length > 0 && (
                            <ul className="mt-2 flex flex-wrap gap-1.5">
                                {block.candidates.map(c => (
                                    <li key={c._id}>
                                        <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => onOpenCandidate(c._id)}>{c.name || 'Candidat'}</Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {block.code === 'SUSPENDED_CANDIDATES' && (
                            <Button variant="outline" size="sm" className="mt-2 h-11 sm:h-8" onClick={() => onShowCandidates({ statut: 'SUSPENDED' })}>Voir les candidats suspendus</Button>
                        )}
                    </Notice>
                )}

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <RoundCard edition={e} k="FREE" canWrite={canWrite} onChanged={onChanged} ask={setConfirm} />
                    <RoundCard edition={e} k="PAID" canWrite={canWrite} onChanged={onChanged} ask={setConfirm} />
                </div>
            </PanelBody>
            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </Panel>
    );
}
