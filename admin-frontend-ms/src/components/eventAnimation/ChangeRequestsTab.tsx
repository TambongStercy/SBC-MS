import { useState } from 'react';
import { CHANGE_REQUEST_STATUS_LABELS, fmtDate, listChangeRequests, reviewChangeRequest, type AnimChangeRequest, type ChangeRequestStatus } from '../../api/animation';
import { CHANGE_STATUS, TARGET_LABELS, fieldLabel, personLabel, showValue, useAnim, useAsync } from './shared';
import { Button, KV, Modal, ReasonConfirm, Section, StatusBadge, Table, selectCls, tdCls, trCls } from './ui';

const title = (cr: AnimChangeRequest) => `${TARGET_LABELS[cr.targetType] ?? 'Élément'} « ${cr.targetName ?? 'sans nom'} »`;
const fields = (n: number) => `${n} champ${n > 1 ? 's' : ''}`;

/**
 * Settings locked once a challenge has started (schedule, voting mode,
 * packs…) change only through a request the organizer makes and SBC decides.
 */
export default function ChangeRequestsTab() {
    const { refresh, notifySuccess } = useAnim();
    const [status, setStatus] = useState<ChangeRequestStatus>('PENDING');
    const [open, setOpen] = useState<AnimChangeRequest | null>(null);
    const [decide, setDecide] = useState<{ cr: AnimChangeRequest; approve: boolean } | null>(null);
    const q = useAsync(() => listChangeRequests({ status }), status);
    const items = q.data ?? [];

    return (
        <div className="space-y-3">
            <p className="text-sm text-fg-muted">
                Certains réglages sont verrouillés une fois un défi lancé (calendrier, mode de vote, packs…). L’organisateur demande alors
                une modification ; l’approuver l’applique immédiatement et l’enregistre comme dérogation dans le journal.
            </p>
            <div className="flex items-center gap-3">
                <select value={status} onChange={e => setStatus(e.target.value as ChangeRequestStatus)} className={selectCls}>
                    {(['PENDING', 'APPROVED', 'REJECTED'] as ChangeRequestStatus[]).map(s => <option key={s} value={s}>{CHANGE_REQUEST_STATUS_LABELS[s]}</option>)}
                </select>
                {q.data && <span className="text-sm text-fg-muted">{items.length} demande{items.length > 1 ? 's' : ''}{items.length >= 200 ? ' (200 max affichées)' : ''}</span>}
            </div>
            <Table headers={['Demande', 'Événement', 'Demandé par', 'Le', 'Statut', '']}
                loading={q.loading && !q.data} error={q.data ? null : q.error} onRetry={q.reload}
                empty={q.data && items.length === 0 ? (status === 'PENDING' ? 'Aucune demande en attente' : 'Aucune demande') : undefined}>
                {items.map(cr => (
                    <tr key={cr._id} className={trCls} onClick={() => setOpen(cr)}>
                        <td className={tdCls}>
                            <div className="font-medium">{title(cr)}</div>
                            <div className="text-xs text-fg-muted">{fields(cr.diff.length)} : {cr.diff.slice(0, 3).map(d => fieldLabel(d.path)).join(', ')}{cr.diff.length > 3 ? '…' : ''}</div>
                        </td>
                        <td className={`${tdCls} text-fg-muted`}>{cr.event?.title ?? 'Événement'}{cr.organizerName ? ` · ${cr.organizerName}` : ''}</td>
                        <td className={`${tdCls} text-fg-muted`}>{personLabel(cr.requester) ?? 'Membre de l’équipe'}</td>
                        <td className={`${tdCls} text-xs text-fg-muted whitespace-nowrap`}>{fmtDate(cr.createdAt)}</td>
                        <td className={tdCls}><StatusBadge status={cr.status} labels={CHANGE_STATUS} /></td>
                        <td className={`${tdCls} whitespace-nowrap`}><Button small>Examiner</Button></td>
                    </tr>
                ))}
            </Table>

            {open && (
                <Modal onClose={() => setOpen(null)} title={title(open)} subtitle={open.event?.title}
                    footer={open.status === 'PENDING' ? <>
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
                        <ul className="divide-y divide-line border border-line rounded-lg">
                            {open.diff.map((d, i) => (
                                <li key={i} className="px-3 py-2.5 text-sm space-y-1">
                                    <p className="font-semibold text-fg">{fieldLabel(d.path)}</p>
                                    <p className="wrap-break-word"><span className="text-fg-muted">Avant : </span><span className="text-red-600 dark:text-red-300 line-through">{showValue(d.from, d.path, open.valueNames)}</span></p>
                                    <p className="wrap-break-word"><span className="text-fg-muted">Après : </span><span className="text-emerald-600 dark:text-emerald-300 font-semibold">{showValue(d.to, d.path, open.valueNames)}</span></p>
                                </li>
                            ))}
                        </ul>
                    </Section>
                    <Section title="Motif de l’organisateur">
                        <p className="text-sm whitespace-pre-wrap bg-surface border border-line rounded-lg p-3">{open.reason}</p>
                    </Section>
                    {open.status !== 'PENDING' && (
                        <p className="text-sm text-fg-muted border-t border-line pt-3">
                            Traité le {fmtDate(open.reviewedAt)}{personLabel(open.reviewer) ? ` par ${personLabel(open.reviewer)}` : ''}{open.reviewNote ? ` — ${open.reviewNote}` : ''}
                        </p>
                    )}
                </Modal>
            )}

            {decide && (
                decide.approve ? (
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
                        message="La demande est refusée et le demandeur est prévenu avec ta note."
                        label="Raison du refus (envoyée au demandeur)" minLength={5} confirmText="Refuser" onCancel={() => setDecide(null)}
                        onConfirm={async (note) => {
                            try { await reviewChangeRequest(decide.cr._id, false, note); } finally { refresh(); }
                            notifySuccess('Modification refusée.');
                            setOpen(null);
                        }} />
                )
            )}
        </div>
    );
}
