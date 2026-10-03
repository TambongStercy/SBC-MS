import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { listAnimationAudit, type AnimAuditEntry } from '../../../api/animation';
import { Button, Card, DataList, EmptyState, KeyValue, Pagination, SectionTitle, Select, Sheet, type Column } from '../../../ui';
import { formatDateTime } from '../../../lib/format';
import { useParamState } from '../../../lib/hooks';
import { MemberById } from '../../members/MemberById';
import { ExportButtons } from './Exports';
import {
    AUDIT_ACTION_LABELS, AUDIT_TARGET_LABELS, FIELD_LABELS, ROLE_LABELS, auditActionLabel, fieldLabel, flatten, showValue, useChallengeIndex,
} from './shared';

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
    if (value === undefined) return <p className="text-sm text-ink-3">—</p>;
    if (Array.isArray(value) && value.every(d => d && typeof d === 'object' && 'path' in d)) {
        return <KeyValue items={(value as Array<{ path: string; from: unknown; to: unknown }>).map(d => [fieldLabel(d.path), `${showValue(d.from, d.path)} → ${showValue(d.to, d.path)}`] as [string, string])} />;
    }
    const lines = flatten(value);
    return <KeyValue items={lines.map(([path, v]) => {
        if (path === 'subject' && typeof v === 'string') return ['Sujet', SUBJECTS[v.split(':')[0]] ?? 'Sujet'] as [string, string];
        return [keyLabel(path), showValue(v, path)] as [string, string];
    })} />;
}

/** Everything done on the module — by organisers, their teams, jurors, SBC and the jobs. */
export function AuditTab() {
    const { challenges, events, challengeName, eventTitle } = useChallengeIndex();
    const [eventId, setEventId] = useState('');
    const [challengeId, setChallengeId] = useParamState('defi', '');
    const [action, setAction] = useState('');
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<AnimAuditEntry | null>(null);

    const q = useQuery({
        queryKey: ['animation', 'audit', eventId, challengeId, action, page],
        queryFn: () => listAnimationAudit({ eventId: eventId || undefined, challengeId: challengeId || undefined, action: action || undefined, page, limit: PAGE }),
        placeholderData: keepPreviousData,
    });
    const set = (fn: () => void) => { fn(); setPage(1); };
    const filtered = Boolean(eventId || challengeId || action);
    const knownChallenge = !challengeId || challenges.some(c => c._id === challengeId);
    const knownEvent = !eventId || events.some(e => e.id === eventId);
    const pickable = eventId ? challenges.filter(c => c.eventId === eventId) : challenges;

    const cols: Column<AnimAuditEntry>[] = [
        { key: 'd', header: 'Date', cell: a => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(a.at)}</span> },
        { key: 'a', header: 'Action', cell: a => <span className="font-semibold">{auditActionLabel(a.action)}</span> },
        { key: 'w', header: 'Par', cell: a => <span className="text-ink-2">{roleLabel(a.actorRole)}</span> },
        { key: 't', header: 'Cible', cell: a => <span className="text-ink-2">{targetLabel(a.targetType)}</span> },
        { key: 'c', header: 'Défi', cell: a => <span className="text-ink-2">{a.challengeId ? challengeName(a.challengeId) : a.eventId ? eventTitle(a.eventId) : '—'}</span> },
        { key: 'r', header: 'Motif', cell: a => <span className="text-ink-2 line-clamp-2 max-w-xs">{a.reason || '—'}</span> },
    ];

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Select aria-label="Événement" value={eventId} onChange={e => set(() => { setEventId(e.target.value); if (e.target.value) setChallengeId(''); })}>
                    <option value="">Tous les événements</option>
                    {!knownEvent && <option value={eventId}>Événement sélectionné</option>}
                    {events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                </Select>
                <Select aria-label="Défi" value={challengeId} onChange={e => set(() => setChallengeId(e.target.value))}>
                    <option value="">Tous les défis</option>
                    {!knownChallenge && <option value={challengeId}>Défi sélectionné</option>}
                    {pickable.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                </Select>
                <Select aria-label="Action" value={action} onChange={e => set(() => setAction(e.target.value))}>
                    <option value="">Toutes les actions</option>
                    {Object.entries(AUDIT_ACTION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
            </div>
            {filtered && <Button variant="ghost" size="sm" onClick={() => set(() => { setEventId(''); setChallengeId(''); setAction(''); })}>Effacer les filtres</Button>}

            <Card className="space-y-1">
                <p className="text-xs text-ink-3">
                    Export du journal {challengeId ? `du défi « ${challengeName(challengeId)} »` : eventId ? `de l’événement « ${eventTitle(eventId)} »` : 'complet'} (le filtre d’action ne s’applique pas à l’export).
                </p>
                <ExportButtons kinds={['audit']} formats={['csv', 'xlsx']} scope={{ eventId: eventId || undefined, challengeId: challengeId || undefined }} />
            </Card>

            <DataList rows={q.data?.items} columns={cols} rowKey={a => a._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={setOpen} empty={<Card><EmptyState title="Aucune entrée" /></Card>}
                card={a => (
                    <span className="block space-y-0.5">
                        <span className="flex items-start justify-between gap-3"><span className="font-semibold">{auditActionLabel(a.action)}</span><span className="text-xs text-ink-3 whitespace-nowrap">{formatDateTime(a.at)}</span></span>
                        <span className="block text-xs text-ink-2 truncate">{roleLabel(a.actorRole)} · {a.challengeId ? challengeName(a.challengeId) : a.eventId ? eventTitle(a.eventId) : targetLabel(a.targetType)}</span>
                        {a.reason && <span className="block text-xs text-ink-3 truncate">{a.reason}</span>}
                    </span>
                )} />
            {q.data && <Pagination page={page} totalPages={Math.max(1, q.data.totalPages)} total={q.data.total} onChange={setPage} />}

            {open && (
                <Sheet open onClose={() => setOpen(null)} size="lg" title={auditActionLabel(open.action)}>
                    <div className="space-y-4">
                        <KeyValue items={[
                            ['Date', formatDateTime(open.at)],
                            ['Rôle', roleLabel(open.actorRole)],
                            ['Cible', targetLabel(open.targetType)],
                            open.eventId ? ['Événement', eventTitle(open.eventId)] : null,
                            open.challengeId ? ['Défi', challengeName(open.challengeId)] : null,
                            open.ip ? ['Adresse IP', open.ip] : null,
                        ]} />
                        {open.actorUserId && <div><SectionTitle>Auteur</SectionTitle><MemberById id={open.actorUserId} fallback={roleLabel(open.actorRole)} /></div>}
                        {open.reason && <div><SectionTitle>Motif</SectionTitle><p className="text-sm whitespace-pre-wrap bg-surface-2 rounded-tile p-3">{open.reason}</p></div>}
                        {open.before !== undefined && <div><SectionTitle>Avant</SectionTitle><Snapshot value={open.before} /></div>}
                        {open.after !== undefined && <div><SectionTitle>Après</SectionTitle><Snapshot value={open.after} /></div>}
                        <div className="flex flex-wrap gap-2">
                            {AUDIT_ACTION_LABELS[open.action] && action !== open.action && (
                                <Button size="sm" variant="secondary" onClick={() => { set(() => setAction(open.action)); setOpen(null); }}>Filtrer sur cette action</Button>
                            )}
                            {open.challengeId && challengeId !== open.challengeId && (
                                <Button size="sm" variant="secondary" onClick={() => { set(() => { setEventId(''); setChallengeId(open.challengeId!); }); setOpen(null); }}>Filtrer sur ce défi</Button>
                            )}
                            {open.eventId && eventId !== open.eventId && (
                                <Button size="sm" variant="secondary" onClick={() => { set(() => { setChallengeId(''); setEventId(open.eventId!); }); setOpen(null); }}>Filtrer sur cet événement</Button>
                            )}
                        </div>
                    </div>
                </Sheet>
            )}
        </div>
    );
}
