import { useState } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { LinkSquare02Icon } from '@hugeicons/core-free-icons';
import { Badge, Button, Panel, PanelBody, PanelHeader, Segmented } from '../ui';
import { ConfirmDialog, Notice, formatNumber, plural, type ConfirmOptions } from '../moduleKit';
import { cn } from '../../lib/cn';
import {
    LIVE_PHASE_LABELS, impactErrorMessage, liveScreenUrl, setOnStage, startFinal, type Edition, type LivePhase,
} from '../../services/impactV2Api';
import RoundCard from './RoundCard';
import { useJury } from './finaleQueries';

const PHASES: LivePhase[] = ['PRESENTATION', 'QUESTIONS', 'SCORING'];

/**
 * The live final: start it, say who is on stage and what is happening (the
 * public live screen shows it), and the final public vote round.
 */
export default function LivePanel({ edition, canWrite, onChanged, onEdition }: {
    edition: Edition;
    canWrite: boolean;
    /** An action that changes the edition's step: store it and reload the rest. */
    onChanged: (e?: Edition) => void;
    /** The on-stage switch: store the edition only (it happens often during the live). */
    onEdition: (e: Edition) => void;
}) {
    const jury = useJury(edition);
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
    const [busy, setBusy] = useState(false);
    const live = edition.stage === 'LIVE';
    const onStage = edition.live?.onStageCandidateId ?? null;
    const phase = edition.live?.phase ?? null;
    const activeJurors = (jury.data?.jurors ?? []).filter(j => !j.removedAt).length;
    const finalists = jury.data?.finalists ?? [];

    const askStart = () => setConfirm({
        title: 'Démarrer la finale ?',
        tone: 'primary',
        confirmLabel: 'Démarrer la finale',
        description: 'La finale passe en direct : les jurés peuvent noter, le vote public de la finale peut s’ouvrir, et les finalistes sont prévenus.',
        body: activeJurors === 0
            ? <Notice tone="warning">Aucun juré actif : ajoutez au moins un juré avant de démarrer.</Notice>
            : <p className="text-sm text-fg-muted">{formatNumber(activeJurors)} {plural(activeJurors, 'juré actif', 'jurés actifs')}. Vous pourrez encore ajouter ou retirer des jurés jusqu’au verrouillage des notes.</p>,
        onConfirm: async () => {
            try {
                onChanged(await startFinal(edition._id));
                toast.success('La finale est en direct.');
            } catch (err) {
                // NO_JURY, WRONG_STAGE: the server says why.
                throw new Error(impactErrorMessage(err, 'La finale n’a pas pu démarrer.'));
            }
        },
    });

    /** Puts a finalist (or nobody) on stage, with a phase; keeps the edition in sync. */
    const stage = async (candidateId: string | null, nextPhase?: LivePhase | null) => {
        setBusy(true);
        try {
            onEdition(await setOnStage(edition._id, candidateId, candidateId ? (nextPhase ?? 'PRESENTATION') : null));
        } catch (err) {
            toast.error(impactErrorMessage(err, 'Le passage sur scène n’a pas pu être enregistré.'));
            onChanged();
        } finally {
            setBusy(false);
        }
    };

    return (
        <Panel>
            <PanelHeader
                title="Finale en direct"
                description={edition.stage === 'TOP3'
                    ? 'Composez le jury, puis démarrez la finale.'
                    : live ? 'Indiquez qui est en scène : l’écran public du direct le montre.' : 'La finale est terminée.'}
                actions={(
                    <Button asChild variant="outline" size="sm" className="h-11 sm:h-8">
                        <a href={liveScreenUrl()} target="_blank" rel="noreferrer noopener">
                            <HugeiconsIcon icon={LinkSquare02Icon} size={14} aria-hidden="true" />Écran public du direct
                        </a>
                    </Button>
                )}
            />
            <PanelBody className="space-y-4">
                {edition.stage === 'TOP3' && canWrite && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        {/* The dialog says how many jurors are active: wait for the jury to load. */}
                        <Button variant="primary" size="lg" onClick={askStart} disabled={!jury.data}>Démarrer la finale</Button>
                        {jury.data && activeJurors === 0 && <p className="text-sm text-fg-muted">Ajoutez d’abord au moins un juré.</p>}
                    </div>
                )}

                {live && (
                    <>
                        <div className="space-y-2">
                            <p className="text-sm font-medium text-fg">En scène</p>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Finaliste en scène">
                                {finalists.map(f => {
                                    const on = onStage === f._id;
                                    return (
                                        <button
                                            key={f._id}
                                            type="button"
                                            aria-pressed={on}
                                            disabled={!canWrite || busy}
                                            onClick={() => void stage(f._id, on ? phase : 'PRESENTATION')}
                                            className={cn(
                                                'flex min-h-20 flex-col items-start justify-center rounded-panel border-2 px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                                on ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:border-line-strong',
                                            )}
                                        >
                                            <span className="text-lg font-semibold text-fg">{f.name}</span>
                                            {on && <Badge tone="primary" className="mt-1">En scène · {phase ? LIVE_PHASE_LABELS[phase] : '—'}</Badge>}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <Segmented<LivePhase>
                                label="Moment en scène"
                                size="lg"
                                value={phase ?? 'PRESENTATION'}
                                onValueChange={p => { if (onStage && canWrite && !busy) void stage(onStage, p); }}
                                options={PHASES.map(p => ({ value: p, label: LIVE_PHASE_LABELS[p] }))}
                                className={cn(!onStage && 'pointer-events-none opacity-50')}
                            />
                            {canWrite && (
                                <Button variant="outline" size="lg" onClick={() => void stage(null)} disabled={busy || !onStage}>Personne en scène</Button>
                            )}
                        </div>
                    </>
                )}

                {(live || edition.stage === 'TOP3' || edition.rounds?.FINAL) && (
                    <RoundCard edition={edition} k="FINAL" canWrite={canWrite} onChanged={onChanged} ask={setConfirm} />
                )}
            </PanelBody>
            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </Panel>
    );
}
