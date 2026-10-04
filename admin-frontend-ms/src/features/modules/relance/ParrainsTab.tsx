import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { MemberPicker } from '../../members/MemberPicker';
import type { Member } from '../../members/api';
import { Badge, Button, ConfirmSheet, DataList, EmptyState, Input, KeyValue, MemberLink, Pagination, SectionTitle, Select, Sheet, notify, type Column } from '../../../ui';
import { formatDate, formatNumber } from '../../../lib/format';
import { errorMessage } from '../../../lib/hooks';
import { listParrains, plural, updateParrain, type Parrain } from './api';

const PAGE = 20;

function States({ p }: { p: Parrain }) {
    const flags = [
        p.sendingPaused && <Badge key="s" tone="warning">Envoi en pause</Badge>,
        p.enrollmentPaused && <Badge key="e" tone="warning">Nouveaux en pause</Badge>,
        !p.enabled && <Badge key="d">Relance des nouveaux coupée</Badge>,
    ].filter(Boolean);
    return flags.length ? <span className="flex flex-wrap gap-1">{flags}</span> : <Badge tone="success">Actif</Badge>;
}

/** A parrain's relance: credits, today's sends, what is paused; pause sending or change the daily limit. */
function ParrainSheet({ p, onClose }: { p: Parrain; onClose: () => void }) {
    const qc = useQueryClient();
    const [confirm, setConfirm] = useState<'sending' | 'enrollment' | null>(null);
    const [limit, setLimit] = useState(String(p.maxMessagesPerDay));
    const [saving, setSaving] = useState(false);
    const [limitError, setLimitError] = useState<string | null>(null);
    useEffect(() => setLimit(String(p.maxMessagesPerDay)), [p.maxMessagesPerDay]);
    const name = p.user?.name ?? 'ce parrain';
    const refresh = () => qc.invalidateQueries({ queryKey: ['relance', 'parrains'] });

    const n = Number(limit);
    const limitValid = Number.isInteger(n) && n >= 1 && n <= 5000;
    const saveLimit = async () => {
        if (!limitValid) { setLimitError('Un nombre entier de 1 à 5 000.'); return; }
        setSaving(true); setLimitError(null);
        try { await updateParrain(p.userId, { maxMessagesPerDay: n }); notify.success('Limite enregistrée.'); refresh(); }
        catch (e) { setLimitError(errorMessage(e)); }
        finally { setSaving(false); }
    };

    return (
        <Sheet open onClose={onClose} title={p.user?.name ?? 'Parrain'}>
            <div className="space-y-5">
                <MemberLink id={p.userId} name={p.user?.name ?? 'Membre introuvable'} phone={p.user?.phoneNumber} />
                <KeyValue items={[
                    ['Crédits e-mail', formatNumber(p.emailBalance)],
                    ['Crédits SMS', p.smsEnabled ? formatNumber(p.smsBalance) : `${formatNumber(p.smsBalance)} · SMS coupés`],
                    ['E-mails envoyés aujourd’hui', `${formatNumber(p.emailsSentToday)} / ${formatNumber(p.maxMessagesPerDay)}`],
                    ['Filleuls en cours', `${formatNumber(p.inLoop.nouveaux)} nouveaux · ${formatNumber(p.inLoop.campaigns)} en campagne`],
                    ['Packs achetés', p.packs.count ? `${formatNumber(p.packs.count)} · dernier le ${formatDate(p.packs.lastAt)}` : 'Aucun'],
                ]} />

                <div>
                    <SectionTitle>Réglages</SectionTitle>
                    <p className="text-sm text-ink-2 mb-3">Une pause n’est pas un blocage : le parrain voit sa relance en pause dans l’app et peut la remettre en marche lui-même.</p>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3 rounded-tile border border-border px-3 py-2.5">
                            <span className="min-w-0"><span className="block text-sm font-semibold">Envoi des messages</span>
                                <span className="block text-xs text-ink-2">{p.sendingPaused ? 'En pause : rien ne part, nouveaux comme campagnes.' : 'Les messages partent normalement.'}</span></span>
                            <Button size="sm" variant={p.sendingPaused ? 'primary' : 'secondary'} onClick={() => setConfirm('sending')}>{p.sendingPaused ? 'Reprendre' : 'Mettre en pause'}</Button>
                        </div>
                        {/* The app no longer offers this pause and doesn't show it, so it is only ever cleared here, never set. */}
                        {p.enrollmentPaused && (
                            <div className="flex items-center justify-between gap-3 rounded-tile border border-warning/40 bg-warning-soft px-3 py-2.5">
                                <span className="min-w-0"><span className="block text-sm font-semibold">Nouveaux filleuls en pause</span>
                                    <span className="block text-xs text-ink-2">Ses nouveaux filleuls n’entrent pas en relance, et l’app ne le lui montre pas.</span></span>
                                <Button size="sm" onClick={() => setConfirm('enrollment')}>Reprendre</Button>
                            </div>
                        )}
                        <div className="rounded-tile border border-border px-3 py-2.5">
                            <div className="flex items-end gap-2">
                                <div className="flex-1"><Input label="E-mails par jour au plus" type="number" inputMode="numeric" min={1} max={5000} value={limit}
                                    onChange={e => { setLimit(e.target.value); setLimitError(null); }} /></div>
                                <Button onClick={saveLimit} loading={saving} disabled={String(p.maxMessagesPerDay) === limit}>Enregistrer</Button>
                            </div>
                            {limitError ? <p className="mt-1 text-xs text-danger">{limitError}</p> : <p className="mt-1 text-xs text-ink-3">Les SMS ne comptent pas dans cette limite.</p>}
                        </div>
                    </div>
                </div>
            </div>

            <ConfirmSheet open={confirm === 'sending'} onClose={() => setConfirm(null)} tone={p.sendingPaused ? 'success' : 'primary'}
                title={p.sendingPaused ? `Reprendre l’envoi pour ${name} ?` : `Mettre en pause l’envoi de ${name} ?`}
                message={<p>{p.sendingPaused ? 'Ses messages repartent au prochain passage, avec ses crédits.' : 'Plus aucun message ne part pour ses filleuls, nouveaux comme campagnes, jusqu’à la reprise. Ses crédits ne bougent pas.'}</p>}
                confirmLabel={p.sendingPaused ? 'Reprendre' : 'Mettre en pause'}
                onConfirm={async () => { await updateParrain(p.userId, { sendingPaused: !p.sendingPaused }); notify.success(p.sendingPaused ? 'Envoi repris.' : 'Envoi en pause.'); refresh(); }} />
            <ConfirmSheet open={confirm === 'enrollment'} onClose={() => setConfirm(null)} tone="success"
                title={`Reprendre l’entrée des nouveaux pour ${name} ?`}
                message={<p>Ses prochains nouveaux filleuls entreront de nouveau en relance.</p>}
                confirmLabel="Reprendre"
                onConfirm={async () => { await updateParrain(p.userId, { enrollmentPaused: false }); notify.success('Réglage enregistré.'); refresh(); }} />
        </Sheet>
    );
}

/** Parrains who use relance: their credits and settings, for support. */
export function ParrainsTab() {
    const [scope, setScope] = useState<'credits' | 'all'>('credits');
    const [member, setMember] = useState<Member | null>(null);
    const [page, setPage] = useState(1);
    const [openId, setOpenId] = useState<string | null>(null);
    const q = useQuery({
        queryKey: ['relance', 'parrains', scope, member?._id, page],
        queryFn: () => listParrains({ withCredits: scope === 'credits' && !member, userId: member?._id, page, limit: PAGE }),
        placeholderData: keepPreviousData,
    });
    const open = q.data?.parrains.find(p => p.userId === openId) ?? null;

    const cols: Column<Parrain>[] = [
        { key: 'n', header: 'Parrain', cell: p => <span className="min-w-0"><span className="block font-semibold truncate">{p.user?.name ?? 'Membre introuvable'}</span><span className="block text-xs text-ink-2">{p.packs.count ? plural(p.packs.count, 'pack acheté', 'packs achetés') : 'Aucun pack'}</span></span> },
        { key: 'e', header: 'Crédits e-mail', align: 'right', cell: p => formatNumber(p.emailBalance) },
        { key: 's', header: 'Crédits SMS', align: 'right', cell: p => formatNumber(p.smsBalance) },
        { key: 't', header: 'E-mails aujourd’hui', align: 'right', cell: p => `${formatNumber(p.emailsSentToday)} / ${formatNumber(p.maxMessagesPerDay)}` },
        { key: 'f', header: 'Filleuls en cours', align: 'right', cell: p => formatNumber(p.inLoop.nouveaux + p.inLoop.campaigns) },
        { key: 'x', header: 'État', cell: p => <States p={p} /> },
    ];
    return (
        <div className="space-y-3">
            <div className="grid sm:grid-cols-[16rem_1fr] gap-2">
                <Select aria-label="Parrains" value={scope} disabled={!!member} onChange={e => { setScope(e.target.value as 'credits' | 'all'); setPage(1); }}>
                    <option value="credits">Avec des crédits</option><option value="all">Tous</option>
                </Select>
                <MemberPicker value={member} onChange={m => { setMember(m); setPage(1); }} />
            </div>
            <DataList rows={q.data?.parrains} columns={cols} rowKey={p => p.userId} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={p => setOpenId(p.userId)}
                empty={<EmptyState title={member ? 'Ce membre n’a jamais ouvert la relance' : 'Aucun parrain'}>{member ? 'Il n’a ni crédits ni réglages de relance.' : null}</EmptyState>}
                card={p => (
                    <span className="block min-w-0">
                        <span className="block font-semibold truncate">{p.user?.name ?? 'Membre introuvable'}</span>
                        <span className="block text-xs text-ink-2">{formatNumber(p.emailBalance)} e-mails · {formatNumber(p.smsBalance)} SMS · {formatNumber(p.inLoop.nouveaux + p.inLoop.campaigns)} filleuls en cours</span>
                        <span className="mt-1.5 block"><States p={p} /></span>
                    </span>
                )} />
            {q.data && <Pagination page={page} totalPages={Math.max(1, q.data.totalPages)} total={q.data.total} onChange={setPage} />}
            {open && <ParrainSheet p={open} onClose={() => setOpenId(null)} />}
        </div>
    );
}
