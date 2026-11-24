import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge, Button } from '../ui';
import { ConfirmDialog, DateText, formatNumber, type ConfirmOptions } from '../moduleKit';
import {
    impactErrorMessage, setPrizeStatus, type TombolaDraw, type TombolaWinner,
} from '../../services/impactV2Api';
import { PrizeStatusBadge } from './shared';

/**
 * The winners of a draw, in prize order, with their prize status (§13.2):
 * « Remis », « Non remis » (reason), back to « En attente ». The ones already
 * shown on the live screen are marked.
 */
export default function TombolaWinners({ editionId, draw, canWrite, onDraw }: {
    editionId: string;
    draw: TombolaDraw;
    canWrite: boolean;
    onDraw: (d: TombolaDraw) => void;
}) {
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
    const [busy, setBusy] = useState<number | null>(null);

    const mark = async (w: TombolaWinner, status: 'DELIVERED' | 'PENDING') => {
        setBusy(w.order);
        try {
            onDraw(await setPrizeStatus(editionId, w.order, status));
            toast.success(status === 'DELIVERED' ? `« ${w.prizeLabel} » marqué remis.` : `« ${w.prizeLabel} » remis en attente.`);
        } catch (err) {
            toast.error(impactErrorMessage(err, 'Le statut du lot n’a pas pu être enregistré.'));
        } finally {
            setBusy(null);
        }
    };
    const askForfeit = (w: TombolaWinner) => setConfirm({
        title: `« ${w.prizeLabel} » non remis ?`,
        confirmLabel: 'Marquer non remis',
        description: `Le lot de ${w.displayName ?? 'ce gagnant'} (ticket n° ${w.ticketNumber}) est noté non remis, avec la raison. Il n’est pas retiré à un autre gagnant.`,
        reason: { label: 'Raison', required: true, minLength: 5, placeholder: 'ex. Gagnant injoignable après 3 relances' },
        onConfirm: async (reason: string) => {
            try {
                onDraw(await setPrizeStatus(editionId, w.order, 'FORFEITED', reason));
                toast.success(`« ${w.prizeLabel} » noté non remis.`);
            } catch (err) {
                throw new Error(impactErrorMessage(err, 'Le statut du lot n’a pas pu être enregistré.'));
            }
        },
    });

    return (
        <>
            <ol className="divide-y divide-line rounded-panel border border-line">
                {draw.winners.map(w => {
                    const shown = w.order <= draw.revealedCount;
                    const awarded = !!w.userId && w.status !== 'NOT_AWARDED';
                    return (
                        <li key={w.order} className="space-y-2 px-4 py-3" data-testid={`winner-${w.order}`}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="font-medium text-fg">{w.order}. {w.prizeLabel}</p>
                                    {awarded ? (
                                        <p className="text-sm text-fg-muted">
                                            Ticket n° <b className="tabular-nums text-fg">{formatNumber(w.ticketNumber)}</b> ·{' '}
                                            <Link to={`/userpage/${w.userId}`} className="text-primary hover:underline">{w.displayName ?? 'Membre SBC'}</Link>
                                            {w.attempts && w.attempts > 1 ? <span className="text-xs"> · {w.attempts} essais</span> : null}
                                        </p>
                                    ) : (
                                        <p className="text-sm text-fg-muted">Plus aucun participant éligible pour ce lot.</p>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1">
                                    {awarded && <Badge tone={shown ? 'primary' : 'outline'}>{shown ? 'Affiché' : 'Pas encore affiché'}</Badge>}
                                    <PrizeStatusBadge status={w.status} />
                                </div>
                            </div>
                            {w.statusNote && <p className="text-xs text-fg-muted">« {w.statusNote} »{w.statusAt ? <> · <DateText value={w.statusAt} /></> : null}</p>}
                            {canWrite && awarded && (
                                <div className="flex flex-wrap gap-2">
                                    {w.status !== 'DELIVERED' && (
                                        <Button variant="outline" size="sm" className="h-11 sm:h-8" loading={busy === w.order} onClick={() => void mark(w, 'DELIVERED')}>Remis</Button>
                                    )}
                                    {w.status !== 'FORFEITED' && (
                                        <Button variant="danger-ghost" size="sm" className="h-11 sm:h-8" onClick={() => askForfeit(w)}>Non remis</Button>
                                    )}
                                    {w.status !== 'PENDING' && (
                                        <Button variant="ghost" size="sm" className="h-11 sm:h-8" disabled={busy === w.order} onClick={() => void mark(w, 'PENDING')}>Remettre en attente</Button>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ol>
            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </>
    );
}
