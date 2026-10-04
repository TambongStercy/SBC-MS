import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAdminDisputes, resolveDispute, type AdminDispute, type DisputeStatus } from '../../../api/event';
import { Button, Card, ConfirmSheet, EmptyState, ErrorState, ListSkeleton, Pagination, Select, StatusBadge, notify } from '../../../ui';
import { formatDateTime } from '../../../lib/format';
import { MemberById } from '../../members/MemberById';
import { DISPUTE_KIND, DISPUTE_STATUS, useEventIndex } from './shared';

const PAGE = 20;

/**
 * Disputes. Deciding records the ruling and notifies the complainant with the
 * note — it refunds nothing by itself (event-service resolveDispute); refund
 * the order from Commandes when the ruling calls for it.
 */
export function DisputesTab() {
    const qc = useQueryClient();
    const { title } = useEventIndex();
    const [status, setStatus] = useState<'' | DisputeStatus>('OPEN');
    const [page, setPage] = useState(1);
    const [decide, setDecide] = useState<{ d: AdminDispute; outcome: 'resolve' | 'reject' } | null>(null);
    const q = useQuery({ queryKey: ['events', 'disputes', status, page], queryFn: () => listAdminDisputes({ status: status || undefined, limit: PAGE, skip: (page - 1) * PAGE }), placeholderData: keepPreviousData });
    return (
        <div className="space-y-3">
            <div className="sm:w-56"><Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value as DisputeStatus | ''); setPage(1); }}>
                <option value="">Tous</option><option value="OPEN">Ouverts</option><option value="RESOLVED">Résolus</option><option value="REJECTED">Rejetés</option>
            </Select></div>
            {q.isLoading ? <ListSkeleton rows={3} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
                <Card><EmptyState title={status === 'OPEN' ? 'Aucun litige ouvert' : 'Aucun litige'} /></Card>
            ) : (
                <ul className="space-y-2">
                    {q.data.items.map(d => (
                        <li key={d._id}><Card className="space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div><p className="font-semibold">{DISPUTE_KIND[d.kind] ?? d.kind}</p><p className="text-sm text-ink-2">{d.eventId ? title(d.eventId) : 'Événement non précisé'} · {formatDateTime(d.createdAt)}</p></div>
                                <StatusBadge status={d.status} labels={DISPUTE_STATUS} />
                            </div>
                            <MemberById id={d.complainantUserId} fallback="Plaignant" />
                            <p className="text-sm whitespace-pre-line bg-surface-2 rounded-tile p-3">{d.description}</p>
                            {d.resolutionNote && <p className="text-sm text-ink-2"><b className="text-ink">Décision :</b> {d.resolutionNote}</p>}
                            {d.status === 'OPEN' && (
                                <div className="grid grid-cols-2 gap-2">
                                    <Button variant="secondary" onClick={() => setDecide({ d, outcome: 'reject' })}>Rejeter…</Button>
                                    <Button variant="success" onClick={() => setDecide({ d, outcome: 'resolve' })}>Donner raison…</Button>
                                </div>
                            )}
                        </Card></li>
                    ))}
                </ul>
            )}
            {q.data && <Pagination page={page} totalPages={Math.max(1, Math.ceil(q.data.total / PAGE))} total={q.data.total} onChange={setPage} />}
            {decide && (
                <ConfirmSheet open onClose={() => setDecide(null)} tone={decide.outcome === 'resolve' ? 'success' : 'primary'}
                    title={decide.outcome === 'resolve' ? 'Donner raison au plaignant ?' : 'Rejeter ce litige ?'}
                    message={<p>Le plaignant reçoit ta décision et ta note. Rien n’est remboursé automatiquement{decide.outcome === 'resolve' ? ' : rembourse la commande depuis l’onglet Commandes si besoin' : ''}.</p>}
                    reason={{ label: 'Note (envoyée au plaignant)', minLength: 5 }}
                    confirmLabel={decide.outcome === 'resolve' ? 'Donner raison' : 'Rejeter'}
                    onConfirm={async (note) => { await resolveDispute(decide.d._id, note, decide.outcome); notify.success('Décision envoyée.'); qc.invalidateQueries({ queryKey: ['events'] }); qc.invalidateQueries({ queryKey: ['queue', 'disputes'] }); }} />
            )}
        </div>
    );
}
