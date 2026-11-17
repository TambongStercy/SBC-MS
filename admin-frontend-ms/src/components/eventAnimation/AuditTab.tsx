import { useEffect, useState } from 'react';
import { fmtDate, listAnimationAudit, type AnimAuditEntry } from '../../api/animation';
import {
    AUDIT_ACTION_LABELS, AUDIT_TARGET_LABELS, FIELD_LABELS, ROLE_LABELS, auditActionLabel, fieldLabel, flatten, showValue, useAnim, useAsync, useChallengeIndex,
} from './shared';
import { InboxIcon } from '@hugeicons/core-free-icons';
import { EmptyState, Panel, ResponsiveList, type ListColumn } from '../ui';
import { DateText, ErrorState, FilterBar, FilterSelect } from '../moduleKit';
import { Button, ExportButtons, KV, Modal, Pager, Section, UserRef } from './ui';

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
    const { param, setParams, apiParams, scopeKey } = useAnim();
    const { challenges, events, challengeName, eventTitle } = useChallengeIndex();
    const challengeId = param('defi');
    const setChallengeId = (id: string) => setParams({ tab: 'journal', ...(id ? { defi: id } : {}) });
    const [eventId, setEventId] = useState('');
    const [action, setAction] = useState('');
    const [page, setPage] = useState(1);
    // a new country/period starts again at page 1
    useEffect(() => { setPage(1); }, [scopeKey]);
    const [open, setOpen] = useState<AnimAuditEntry | null>(null);
    const [showExport, setShowExport] = useState(false);

    const q = useAsync(
        () => listAnimationAudit({ eventId: eventId || undefined, challengeId: challengeId || undefined, action: action || undefined, page, limit: PAGE, ...apiParams }),
        `${eventId}|${challengeId}|${action}|${page}|${scopeKey}`,
    );
    const items = q.data?.items ?? [];
    const set = (fn: () => void) => { fn(); setPage(1); };
    const filtered = Boolean(eventId || challengeId || action);
    const knownChallenge = !challengeId || challenges.some(c => c._id === challengeId);
    const knownEvent = !eventId || events.some(e => e.id === eventId);
    const pickable = eventId ? challenges.filter(c => c.eventId === eventId) : challenges;

    const columns: ListColumn<AnimAuditEntry>[] = [
        { key: 'action', header: 'Action', cell: a => <span className="font-medium text-fg">{auditActionLabel(a.action)}</span> },
        { key: 'by', header: 'Par', cell: a => <span className="text-fg-muted">{roleLabel(a.actorRole)}</span> },
        { key: 'target', header: 'Cible', cell: a => <span className="text-fg-muted">{targetLabel(a.targetType)}</span> },
        { key: 'scope', header: 'Défi', cell: a => <span className="text-fg-muted">{a.challengeId ? challengeName(a.challengeId) : a.eventId ? eventTitle(a.eventId) : '—'}</span> },
        { key: 'reason', header: 'Motif', className: 'max-w-xs', cell: a => <span className="block max-w-xs truncate text-fg-muted">{a.reason || '—'}</span> },
        { key: 'at', header: 'Date', cell: a => <DateText value={a.at} className="text-fg-muted" /> },
    ];

    return (
        <div className="space-y-4">
            <Panel>
                <div className="space-y-3 border-b border-line p-4">
                    <FilterBar
                        filterCount={3}
                        activeCount={(eventId ? 1 : 0) + (challengeId ? 1 : 0) + (action ? 1 : 0)}
                        onClear={() => set(() => { setEventId(''); setChallengeId(''); setAction(''); })}
                        filters={(
                            <>
                                <FilterSelect label="Événement" allLabel="Tous les événements" value={eventId}
                                    onChange={v => set(() => { setEventId(v); if (v) setChallengeId(''); })}
                                    options={[...(!knownEvent ? [{ value: eventId, label: 'Événement sélectionné' }] : []), ...events.map(e => ({ value: e.id, label: e.title }))]} />
                                <FilterSelect label="Défi" allLabel="Tous les défis" value={challengeId} onChange={v => set(() => setChallengeId(v))}
                                    options={[...(!knownChallenge ? [{ value: challengeId, label: 'Défi sélectionné' }] : []), ...pickable.map(c => ({ value: c._id, label: c.name }))]} />
                                <FilterSelect label="Action" allLabel="Toutes les actions" value={action} onChange={v => set(() => setAction(v))}
                                    options={Object.entries(AUDIT_ACTION_LABELS).map(([k, l]) => ({ value: k, label: l }))} />
                            </>
                        )}
                        trailing={<Button onClick={() => setShowExport(v => !v)}>{showExport ? 'Masquer l’export' : 'Exporter…'}</Button>}
                    />
                    {showExport && (
                        <div className="rounded-panel border border-line p-4">
                            <p className="mb-1 text-xs text-fg-muted">
                                Export du journal {challengeId ? `du défi « ${challengeName(challengeId)} »` : eventId ? `de l’événement « ${eventTitle(eventId)} »` : 'complet'} (le filtre d’action ne s’applique pas à l’export).
                            </p>
                            <ExportButtons kinds={['audit']} formats={['csv', 'xlsx']} scope={{ eventId: eventId || undefined, challengeId: challengeId || undefined }} />
                        </div>
                    )}
                </div>
                <div className={q.loading && q.data ? 'opacity-60 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={items}
                        columns={columns}
                        rowKey={a => a._id}
                        onRowClick={setOpen}
                        loading={q.loading && !q.data}
                        empty={q.error && !q.data ? <ErrorState error={new Error(q.error)} onRetry={q.reload} /> : (
                            <EmptyState icon={InboxIcon} title="Aucune entrée" description={filtered ? 'Aucune entrée ne correspond à ces filtres.' : undefined} />
                        )}
                    />
                </div>
                {q.data && <Pager page={page} totalPages={Math.max(1, q.data.totalPages)} total={q.data.total} pageSize={PAGE} onChange={setPage} />}
            </Panel>

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
                    {open.reason && <Section title="Motif"><p className="whitespace-pre-wrap rounded-panel border border-line p-3 text-sm text-fg">{open.reason}</p></Section>}
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
