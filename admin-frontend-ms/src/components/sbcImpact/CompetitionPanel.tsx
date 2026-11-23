import { useState } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Button, Panel, PanelBody, PanelHeader } from '../ui';
import { ConfirmDialog, Notice, type ConfirmOptions } from '../moduleKit';
import { cn } from '../../lib/cn';
import {
    STAGE_LABELS, advanceStage, impactErrorMessage, launchCompetition, readImpactError, roundOf, type Edition, type Stage,
} from '../../services/impactV2Api';
import RoundCard from './RoundCard';

const STEPS: { stage: Stage; label: string }[] = [
    { stage: 'WEEK1', label: 'Semaine 1' },
    { stage: 'WEEK2', label: 'Semaine 2' },
    { stage: 'WEEK3', label: 'Semaine 3' },
    { stage: 'TOP3', label: 'TOP 3' },
    { stage: 'LIVE', label: 'Finale' },
    { stage: 'RESULT', label: 'Résultat' },
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

/**
 * The final's next step, as a link to the « Finale » tab where it is done
 * (jury, start, who is on stage, marks, result live there).
 */
function finalAction(e: Edition, onShowFinal: () => void) {
    const label = e.stage === 'TOP3'
        ? 'Jury et démarrage de la finale'
        : e.stage === 'LIVE' && !e.jury?.lockedAt
            ? 'Direct et notes du jury'
            : e.stage === 'LIVE'
                ? 'Publier le résultat'
                : null;
    if (!label) return null;
    return (
        <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={onShowFinal}>
            {label}<HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
        </Button>
    );
}

type LaunchBlock = { code: string; message: string; candidates: { _id: string; name: string }[] };

/**
 * The competition, driven by the edition's status and stage: the steps, the
 * launch and the move to the next week, and the two vote rounds.
 */
export default function CompetitionPanel({ edition, canWrite, onChanged, onOpenCandidate, onShowCandidates, onShowTop3, onShowFinal }: {
    edition: Edition;
    canWrite: boolean;
    /** The answer of an action (the page stores it and reloads the rest); nothing = just reload. */
    onChanged: (e?: Edition) => void;
    onOpenCandidate: (id: string) => void;
    onShowCandidates: (filter: Record<string, string>) => void;
    onShowTop3: () => void;
    /** The final's actions (start, lock, publish) live in the « Finale » tab. */
    onShowFinal: () => void;
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
                        : e.status === 'FINAL' ? finalAction(e, onShowFinal)
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
