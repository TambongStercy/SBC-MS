import { useState } from 'react';
import { fmtDate, listAnimationAudit, type AnimAuditEntry } from '../../api/animation';
import {
    AUDIT_ACTION_LABELS, AUDIT_TARGET_LABELS, FIELD_LABELS, ROLE_LABELS, auditActionLabel, fieldLabel, flatten, showValue, useAnim, useAsync, useChallengeIndex,
} from './shared';
import { Button, Card, ExportButtons, KV, Modal, Pager, Section, Table, UserRef, selectCls, tdCls, trCls } from './ui';

const PAGE = 50;
const roleLabel = (r: string) => ROLE_LABELS[r] ?? 'Autre';
const targetLabel = (t: string) => AUDIT_TARGET_LABELS[t] ?? 'Élément';

/** Keys found in snapshots written by the services, beyond the editor fields. */
const SNAPSHOT_KEYS: Record<string, string> = {
    refundedTransactions: 'Achats remboursés', voidedFreeVotes: 'Votes gratuits annulés', refunded: 'Achats remboursés',
    disqualified: 'Candidats disqualifiés', amount: 'Montant', votes: 'Votes', podium: 'Podium (numéros)', inputsHash: 'Empreinte de contrôle',
    subject: 'Sujet', contact: 'Contact', role: 'Rôle', status: 'Statut', from: 'De', to: 'Vers', reason: 'Motif',
};
const SUBJECTS: Record<string, string> = { USER: 'Compte', TRANSACTION: 'Achat de votes', CANDIDATE: 'Candidat', IP: 'Réseau / appareil' };
const keyLabel = (path: string) => {
    const last = path.split('.').pop() ?? path;
    return FIELD_LABELS[path] ?? SNAPSHOT_KEYS[path] ?? SNAPSHOT_KEYS[last] ?? fieldLabel(path);
};

/** A before/after snapshot as label → value lines. A lock override's diff reads as field: before → after. */
function Snapshot({ value }: { value: unknown }) {
    if (value === undefined) return <p className="text-sm text-fg-muted">—</p>;
    if (Array.isArray(value) && value.every(d => d && typeof d === 'object' && 'path' in d)) {
        return <KV items={(value as Array<{ path: string; from: unknown; to: unknown }>).map(d => [fieldLabel(d.path), `${showValue(d.from, d.path)} → ${showValue(d.to, d.path)}`] as [string, string])} />;
    }
    return <KV items={flatten(value).map(([path, v]) => {
        if (path === 'subject' && typeof v === 'string') return ['Sujet', SUBJECTS[v.split(':')[0]] ?? 'Sujet'] as [string, string];
        return [keyLabel(path), showValue(v, path)] as [string, string];
    })} />;
}

/** Everything done on the module — by organisers, their teams, jurors, SBC and the jobs. */
export default function AuditTab() {
    const { param, setParams } = useAnim();
    const { challenges, events, challengeName, eventTitle } = useChallengeIndex();
    const challengeId = param('defi');
    const setChallengeId = (id: string) => setParams({ tab: 'journal', ...(id ? { defi: id } : {}) });
    const [eventId, setEventId] = useState('');
    const [action, setAction] = useState('');
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<AnimAuditEntry | null>(null);

    const q = useAsync(
        () => listAnimationAudit({ eventId: eventId || undefined, challengeId: challengeId || undefined, action: action || undefined, page, limit: PAGE }),
        `${eventId}|${challengeId}|${action}|${page}`,
    );
    const items = q.data?.items ?? [];
    const set = (fn: () => void) => { fn(); setPage(1); };
    const filtered = Boolean(eventId || challengeId || action);
    const knownChallenge = !challengeId || challenges.some(c => c._id === challengeId);
    const knownEvent = !eventId || events.some(e => e.id === eventId);
    const pickable = eventId ? challenges.filter(c => c.eventId === eventId) : challenges;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <select value={eventId} onChange={e => set(() => { setEventId(e.target.value); if (e.target.value) setChallengeId(''); })} className={`${selectCls} max-w-xs`}>
                    <option value="">Tous les événements</option>
                    {!knownEvent && <option value={eventId}>Événement sélectionné</option>}
                    {events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
                <select value={challengeId} onChange={e => set(() => setChallengeId(e.target.value))} className={`${selectCls} max-w-xs`}>
                    <option value="">Tous les défis</option>
                    {!knownChallenge && <option value={challengeId}>Défi sélectionné</option>}
                    {pickable.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
                <select value={action} onChange={e => set(() => setAction(e.target.value))} className={`${selectCls} max-w-xs`}>
                    <option value="">Toutes les actions</option>
                    {Object.entries(AUDIT_ACTION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {filtered && <Button onClick={() => set(() => { setEventId(''); setChallengeId(''); setAction(''); })}>Effacer les filtres</Button>}
            </div>

            <Card className="space-y-1">
                <p className="text-xs text-fg-muted">
                    Export du journal {challengeId ? `du défi « ${challengeName(challengeId)} »` : eventId ? `de l’événement « ${eventTitle(eventId)} »` : 'complet'} (le filtre d’action ne s’applique pas à l’export).
                </p>
                <ExportButtons kinds={['audit']} formats={['csv', 'xlsx']} scope={{ eventId: eventId || undefined, challengeId: challengeId || undefined }} />
            </Card>

            <Table headers={['Date', 'Action', 'Par', 'Cible', 'Défi', 'Motif']}
                loading={q.loading && !q.data} error={q.data ? null : q.error} onRetry={q.reload}
                empty={q.data && items.length === 0 ? 'Aucune entrée' : undefined}>
                {items.map(a => (
                    <tr key={a._id} className={trCls} onClick={() => setOpen(a)}>
                        <td className={`${tdCls} text-xs text-fg-muted whitespace-nowrap`}>{fmtDate(a.at)}</td>
                        <td className={`${tdCls} font-medium`}>{auditActionLabel(a.action)}</td>
                        <td className={`${tdCls} text-fg-muted`}>{roleLabel(a.actorRole)}</td>
                        <td className={`${tdCls} text-fg-muted`}>{targetLabel(a.targetType)}</td>
                        <td className={`${tdCls} text-fg-muted`}>{a.challengeId ? challengeName(a.challengeId) : a.eventId ? eventTitle(a.eventId) : '—'}</td>
                        <td className={`${tdCls} text-fg-muted max-w-xs truncate`}>{a.reason || '—'}</td>
                    </tr>
                ))}
            </Table>
            {q.data && <Pager page={page} totalPages={Math.max(1, q.data.totalPages)} total={q.data.total} onChange={setPage} />}

            {open && (
                <Modal onClose={() => setOpen(null)} title={auditActionLabel(open.action)} subtitle={fmtDate(open.at)}>
                    <KV items={[
                        ['Date', fmtDate(open.at)],
                        ['Rôle', roleLabel(open.actorRole)],
                        ['Cible', targetLabel(open.targetType)],
                        open.eventId ? ['Événement', eventTitle(open.eventId)] : null,
                        open.challengeId ? ['Défi', challengeName(open.challengeId)] : null,
                        open.ip ? ['Adresse IP', open.ip] : null,
                    ]} />
                    {open.actorUserId && <Section title="Auteur"><UserRef id={open.actorUserId} fallback={roleLabel(open.actorRole)} /></Section>}
                    {open.reason && <Section title="Motif"><p className="text-sm whitespace-pre-wrap bg-surface border border-line rounded-lg p-3">{open.reason}</p></Section>}
                    {open.before !== undefined && <Section title="Avant"><Snapshot value={open.before} /></Section>}
                    {open.after !== undefined && <Section title="Après"><Snapshot value={open.after} /></Section>}
                    <div className="flex flex-wrap gap-2">
                        {AUDIT_ACTION_LABELS[open.action] && action !== open.action && (
                            <Button small onClick={() => { set(() => setAction(open.action)); setOpen(null); }}>Filtrer sur cette action</Button>
                        )}
                        {open.challengeId && challengeId !== open.challengeId && (
                            <Button small onClick={() => { set(() => { setEventId(''); setChallengeId(open.challengeId!); }); setOpen(null); }}>Filtrer sur ce défi</Button>
                        )}
                        {open.eventId && eventId !== open.eventId && (
                            <Button small onClick={() => { set(() => { setChallengeId(''); setEventId(open.eventId!); }); setOpen(null); }}>Filtrer sur cet événement</Button>
                        )}
                    </div>
                </Modal>
            )}
        </div>
    );
}
