import { useState } from 'react';
import { InboxIcon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { CHANGE_REQUEST_STATUS_LABELS, fmtDate, listChangeRequests, reviewChangeRequest, type AnimChangeRequest, type ChangeRequestStatus } from '../../api/animation';
import { Can } from '../Can';
import { usePermission } from '../../hooks/usePermission';
import { EmptyState, Panel, ResponsiveList, Segmented, type ListColumn } from '../ui';
import { DateText, ErrorState, Notice } from '../moduleKit';
import { CHANGE_STATUS, TARGET_LABELS, fieldLabel, personLabel, showValue, useAnim, useAsync } from './shared';
import { Button, KV, Modal, ReasonConfirm, Section, StatusBadge } from './ui';

const title = (cr: AnimChangeRequest) => `${TARGET_LABELS[cr.targetType] ?? 'Élément'} « ${cr.targetName ?? 'sans nom'} »`;
const fields = (n: number) => `${n} champ${n > 1 ? 's' : ''}`;
const STATUSES: ChangeRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

/**
 * Settings locked once a challenge has started (schedule, voting mode,
 * packs…) change only through a request the organizer makes and SBC decides.
 */
export default function ChangeRequestsTab() {
    const { refresh, notifySuccess, apiParams, queueParams, scopeKey } = useAnim();
    const canWrite = usePermission('events') === 'write';
    const [status, setStatus] = useState<ChangeRequestStatus>('PENDING');
    const [open, setOpen] = useState<AnimChangeRequest | null>(null);
    const [decide, setDecide] = useState<{ cr: AnimChangeRequest; approve: boolean } | null>(null);
    // pending requests are a queue: country only, whatever the period
    const q = useAsync(() => listChangeRequests({ status, ...(status === 'PENDING' ? queueParams : apiParams) }), `${status}|${scopeKey}`);
    const items = q.data ?? [];

    const columns: ListColumn<AnimChangeRequest>[] = [
        {
            key: 'request', header: 'Demande', cell: cr => (
                <div className="min-w-0">
                    <p className="font-medium text-fg">{title(cr)}</p>
                    <p className="text-xs text-fg-muted">{fields(cr.diff.length)} : {cr.diff.slice(0, 3).map(d => fieldLabel(d.path)).join(', ')}{cr.diff.length > 3 ? '…' : ''}</p>
                </div>
            ),
        },
        { key: 'event', header: 'Événement', cell: cr => <span className="text-fg-muted">{cr.event?.title ?? 'Événement'}{cr.organizerName ? ` · ${cr.organizerName}` : ''}</span> },
        { key: 'by', header: 'Demandé par', cell: cr => <span className="text-fg-muted">{personLabel(cr.requester) ?? 'Membre de l’équipe'}</span> },
        { key: 'at', header: 'Le', cell: cr => <DateText value={cr.createdAt} className="text-fg-muted" /> },
        { key: 'status', header: 'Statut', cell: cr => <StatusBadge status={cr.status} labels={CHANGE_STATUS} /> },
        {
            key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true,
            cell: cr => <Button small variant={cr.status === 'PENDING' ? 'primary' : 'secondary'} onClick={() => setOpen(cr)}>{cr.status === 'PENDING' ? 'Examiner' : 'Voir'}</Button>,
        },
    ];

    return (
        <div className="space-y-4">
            <Notice icon={InformationCircleIcon}>
                Certains réglages sont verrouillés une fois un défi lancé (calendrier, mode de vote, packs…). L’organisateur demande alors
                une modification ; l’approuver l’applique immédiatement et l’enregistre comme dérogation dans le journal.
            </Notice>
            <Panel>
                <div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                    <Segmented label="Statut des demandes" value={status} onValueChange={setStatus}
                        options={STATUSES.map(s => ({ value: s, label: CHANGE_REQUEST_STATUS_LABELS[s] }))} />
                    {q.data && <span className="text-sm text-fg-muted">{items.length} demande{items.length > 1 ? 's' : ''}{items.length >= 200 ? ' (200 max affichées)' : ''}</span>}
                </div>
                <div className={q.loading && q.data ? 'opacity-60 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={items}
                        columns={columns}
                        rowKey={cr => cr._id}
                        onRowClick={setOpen}
                        loading={q.loading && !q.data}
                        empty={q.error && !q.data ? <ErrorState error={new Error(q.error)} onRetry={q.reload} /> : (
                            <EmptyState icon={InboxIcon} title={status === 'PENDING' ? 'Aucune demande en attente' : 'Aucune demande'}
                                description={status === 'PENDING' ? 'Tout est traité.' : undefined} />
                        )}
                    />
                </div>
            </Panel>

            {open && (
                <Modal onClose={() => setOpen(null)} title={title(open)} subtitle={open.event?.title}
                    footer={open.status === 'PENDING' && canWrite ? <>
                        <Button variant="danger" onClick={() => setDecide({ cr: open, approve: false })}>Refuser…</Button>
                        <Button variant="success" onClick={() => setDecide({ cr: open, approve: true })}>Approuver…</Button>
                    </> : undefined}>
                    <StatusBadge status={open.status} labels={CHANGE_STATUS} />
                    <KV items={[
                        ['Événement', open.event?.title ?? 'Événement'],
                        open.organizerName ? ['Organisateur', open.organizerName] : null,
                        ['Demandé par', personLabel(open.requester) ?? 'Membre de l’équipe'],
                        ['Le', fmtDate(open.createdAt)],
                    ]} />
                    <Section title={`Modification demandée (${fields(open.diff.length)})`}>
                        <ul className="divide-y divide-line rounded-panel border border-line">
                            {open.diff.map((d, i) => (
                                <li key={i} className="space-y-1 px-4 py-2.5 text-sm">
                                    <p className="font-medium text-fg">{fieldLabel(d.path)}</p>
                                    <p className="break-words"><span className="text-fg-muted">Avant : </span><span className="text-fg-muted line-through">{showValue(d.from, d.path, open.valueNames)}</span></p>
                                    <p className="break-words"><span className="text-fg-muted">Après : </span><span className="font-semibold text-fg">{showValue(d.to, d.path, open.valueNames)}</span></p>
                                </li>
                            ))}
                        </ul>
                    </Section>
                    <Section title="Motif de l’organisateur">
                        <p className="whitespace-pre-wrap rounded-panel border border-line p-3 text-sm text-fg">{open.reason}</p>
                    </Section>
                    {open.status !== 'PENDING' && (
                        <p className="border-t border-line pt-3 text-sm text-fg-muted">
                            Traité le {fmtDate(open.reviewedAt)}{personLabel(open.reviewer) ? ` par ${personLabel(open.reviewer)}` : ''}{open.reviewNote ? ` — ${open.reviewNote}` : ''}
                        </p>
                    )}
                </Modal>
            )}

            {decide && (
                <Can module="events" write>
                    {decide.approve ? (
                        <ReasonConfirm open title="Approuver la modification ?" variant="success"
                            message={`La modification (${fields(decide.cr.diff.length)}) est appliquée immédiatement malgré le verrou, et le demandeur est prévenu.`}
                            label="Note (facultative, envoyée au demandeur)" optional confirmText="Approuver" onCancel={() => setDecide(null)}
                            onConfirm={async (note) => {
                                try { await reviewChangeRequest(decide.cr._id, true, note || undefined); } finally { refresh(); }
                                notifySuccess('Modification approuvée et appliquée.');
                                setOpen(null);
                            }} />
                    ) : (
                        <ReasonConfirm open title="Refuser la modification ?"
                            message="La demande est refusée et le demandeur est prévenu avec votre note."
                            label="Raison du refus (envoyée au demandeur)" minLength={5} confirmText="Refuser" onCancel={() => setDecide(null)}
                            onConfirm={async (note) => {
                                try { await reviewChangeRequest(decide.cr._id, false, note); } finally { refresh(); }
                                notifySuccess('Modification refusée.');
                                setOpen(null);
                            }} />
                    )}
                </Can>
            )}
        </div>
    );
}
