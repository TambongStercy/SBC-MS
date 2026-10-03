import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CHANGE_REQUEST_STATUS_LABELS, listChangeRequests, reviewChangeRequest, type AnimChangeRequest, type ChangeRequestStatus } from '../../../api/animation';
import { Button, Card, ConfirmSheet, DataList, EmptyState, KeyValue, SectionTitle, Select, Sheet, StatusBadge, Textarea, notify, type Column } from '../../../ui';
import { formatDateTime } from '../../../lib/format';
import { CHANGE_STATUS, TARGET_LABELS, fieldLabel, personLabel, showValue, useAnimRefresh } from './shared';

const title = (cr: AnimChangeRequest) => `${TARGET_LABELS[cr.targetType] ?? 'Élément'} « ${cr.targetName ?? 'sans nom'} »`;
const fields = (n: number) => `${n} champ${n > 1 ? 's' : ''}`;

/**
 * Settings locked once a challenge has started (schedule, voting mode,
 * packs…) change only through a request the organizer makes and SBC decides.
 */
export function ChangeRequestsTab() {
    const refresh = useAnimRefresh();
    const [status, setStatus] = useState<ChangeRequestStatus>('PENDING');
    const [open, setOpen] = useState<AnimChangeRequest | null>(null);
    const [decide, setDecide] = useState<'approve' | 'reject' | null>(null);
    const [approveNote, setApproveNote] = useState('');
    const q = useQuery({ queryKey: ['animation', 'change-requests', status], queryFn: () => listChangeRequests({ status }) });
    const items = q.data;

    const cols: Column<AnimChangeRequest>[] = [
        { key: 't', header: 'Demande', cell: cr => <span><span className="block font-semibold">{title(cr)}</span><span className="block text-xs text-ink-2">{fields(cr.diff.length)} : {cr.diff.slice(0, 3).map(d => fieldLabel(d.path)).join(', ')}{cr.diff.length > 3 ? '…' : ''}</span></span> },
        { key: 'e', header: 'Événement', cell: cr => <span className="text-ink-2">{cr.event?.title ?? 'Événement'}{cr.organizerName ? ` · ${cr.organizerName}` : ''}</span> },
        { key: 'r', header: 'Demandé par', cell: cr => <span className="text-ink-2">{personLabel(cr.requester) ?? 'Membre de l’équipe'}</span> },
        { key: 'd', header: 'Le', cell: cr => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(cr.createdAt)}</span> },
        { key: 's', header: 'Statut', cell: cr => <StatusBadge status={cr.status} labels={CHANGE_STATUS} /> },
    ];

    return (
        <div className="space-y-3">
            <p className="text-sm text-ink-2">
                Certains réglages sont verrouillés une fois un défi lancé (calendrier, mode de vote, packs…). L’organisateur demande alors
                une modification ; l’approuver l’applique immédiatement et l’enregistre comme dérogation dans le journal.
            </p>
            <div className="flex items-center gap-3">
                <div className="w-full sm:w-56"><Select aria-label="Statut" value={status} onChange={e => setStatus(e.target.value as ChangeRequestStatus)}>
                    {(['PENDING', 'APPROVED', 'REJECTED'] as ChangeRequestStatus[]).map(s => <option key={s} value={s}>{CHANGE_REQUEST_STATUS_LABELS[s]}</option>)}
                </Select></div>
                {items && <span className="shrink-0 text-sm text-ink-3">{items.length} demande{items.length > 1 ? 's' : ''}{items.length >= 200 ? ' (200 max affichées)' : ''}</span>}
            </div>
            <DataList rows={items} columns={cols} rowKey={cr => cr._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={setOpen} empty={<Card><EmptyState title={status === 'PENDING' ? 'Aucune demande en attente' : 'Aucune demande'} /></Card>}
                card={cr => (
                    <span className="block space-y-1">
                        <span className="flex items-start justify-between gap-3"><span className="min-w-0 font-semibold">{title(cr)}</span><StatusBadge status={cr.status} labels={CHANGE_STATUS} /></span>
                        <span className="block text-xs text-ink-2 truncate">{cr.event?.title ?? 'Événement'}{cr.organizerName ? ` · ${cr.organizerName}` : ''}</span>
                        <span className="block text-xs text-ink-3">{fields(cr.diff.length)} · {formatDateTime(cr.createdAt)}</span>
                    </span>
                )} />

            {open && (
                <Sheet open onClose={() => setOpen(null)} size="lg" title={title(open)}
                    footer={open.status === 'PENDING' ? (
                        <div className="grid grid-cols-2 gap-2">
                            <Button variant="danger-soft" onClick={() => setDecide('reject')}>Refuser…</Button>
                            <Button variant="success" onClick={() => { setApproveNote(''); setDecide('approve'); }}>Approuver…</Button>
                        </div>
                    ) : undefined}>
                    <div className="space-y-4">
                        <StatusBadge status={open.status} labels={CHANGE_STATUS} />
                        <KeyValue items={[
                            ['Événement', open.event?.title ?? 'Événement'],
                            open.organizerName ? ['Organisateur', open.organizerName] : null,
                            ['Demandé par', personLabel(open.requester) ?? 'Membre de l’équipe'],
                            ['Le', formatDateTime(open.createdAt)],
                        ]} />
                        <section>
                            <SectionTitle>Modification demandée ({fields(open.diff.length)})</SectionTitle>
                            <ul className="divide-y divide-border border border-border rounded-tile">
                                {open.diff.map((d, i) => (
                                    <li key={i} className="px-3 py-2.5 text-sm space-y-1">
                                        <p className="font-semibold text-ink">{fieldLabel(d.path)}</p>
                                        <p className="break-words"><span className="text-ink-3">Avant : </span><span className="text-danger line-through decoration-danger/40">{showValue(d.from, d.path, open.valueNames)}</span></p>
                                        <p className="break-words"><span className="text-ink-3">Après : </span><span className="text-success font-semibold">{showValue(d.to, d.path, open.valueNames)}</span></p>
                                    </li>
                                ))}
                            </ul>
                        </section>
                        <div className="text-sm"><SectionTitle>Motif de l’organisateur</SectionTitle><p className="whitespace-pre-wrap bg-surface-2 rounded-tile p-3">{open.reason}</p></div>
                        {open.status !== 'PENDING' && (
                            <p className="text-sm text-ink-2 border-t border-border pt-3">
                                Traité le {formatDateTime(open.reviewedAt)}{personLabel(open.reviewer) ? ` par ${personLabel(open.reviewer)}` : ''}{open.reviewNote ? ` — ${open.reviewNote}` : ''}
                            </p>
                        )}
                    </div>
                </Sheet>
            )}

            {open && (
                <>
                    <ConfirmSheet open={decide === 'approve'} onClose={() => setDecide(null)} tone="success" title="Approuver la modification ?"
                        message={<>
                            <p>La modification ({fields(open.diff.length)}) est appliquée immédiatement malgré le verrou, et le demandeur est prévenu.</p>
                            <Textarea label="Note (facultative, envoyée au demandeur)" rows={2} maxLength={1000} value={approveNote} onChange={e => setApproveNote(e.target.value)} />
                        </>}
                        confirmLabel="Approuver"
                        onConfirm={async () => {
                            try {
                                await reviewChangeRequest(open._id, true, approveNote.trim() || undefined);
                            } finally { refresh(); }
                            notify.success('Modification approuvée et appliquée.');
                            setOpen(null);
                        }} />
                    <ConfirmSheet open={decide === 'reject'} onClose={() => setDecide(null)} tone="danger" title="Refuser la modification ?"
                        message={<p>La demande est refusée et le demandeur est prévenu avec ta note.</p>}
                        reason={{ label: 'Raison du refus (envoyée au demandeur)', minLength: 5 }}
                        confirmLabel="Refuser"
                        onConfirm={async (note) => {
                            try {
                                await reviewChangeRequest(open._id, false, note);
                            } finally { refresh(); }
                            notify.success('Modification refusée.');
                            setOpen(null);
                        }} />
                </>
            )}
        </div>
    );
}
