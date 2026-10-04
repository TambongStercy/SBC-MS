import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import apiClient from '../../../api/apiClient';
import { getDiffuseurLeaderboard, type LeaderboardEntry } from '../../../api/adsNetwork';
import { Badge, Button, ConfirmSheet, DataList, EmptyState, KeyValue, MemberLink, Pagination, Select, Sheet, Switch, notify, type Column } from '../../../ui';
import { formatNumber } from '../../../lib/format';
import { countryName } from '../../../lib/labels';

const ban = (userId: string, reason: string) => apiClient.post(`/advertising/admin/diffuseurs/${userId}/ban`, { reason });
const unban = (userId: string) => apiClient.post(`/advertising/admin/diffuseurs/${userId}/unban`);
const pct = (r: number) => `${(r * 100).toFixed(1).replace('.', ',')} %`;

/** Diffuseurs ranked by measured audience, clicks or trust; ban and lift bans from here. */
export function DiffuseursTab() {
    const [sortBy, setSortBy] = useState<'views' | 'clicks' | 'trust'>('views');
    const [measuredOnly, setMeasuredOnly] = useState(false);
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<LeaderboardEntry | null>(null);
    const [action, setAction] = useState<'ban' | 'unban' | null>(null);
    const q = useQuery({ queryKey: ['ads', 'diffuseurs', sortBy, measuredOnly, page], queryFn: () => getDiffuseurLeaderboard({ sortBy, measuredOnly, page, limit: 20 }), placeholderData: keepPreviousData });
    const totalPages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 20));

    const views = (d: LeaderboardEntry) => (
        <span>{formatNumber(Math.round(d.averageViews))}{!d.isMeasured && <Badge className="ml-1.5" tone="warning">déclarées</Badge>}</span>
    );
    const cols: Column<LeaderboardEntry>[] = [
        { key: 'n', header: 'Diffuseur', cell: d => <MemberLink id={d.userId} name={d.name} phone={d.phoneNumber} /> },
        { key: 'c', header: 'Pays', cell: d => <span className="text-ink-2">{countryName(d.country)}</span> },
        { key: 'v', header: 'Vues par statut', align: 'right', cell: views },
        { key: 'k', header: 'Taux de clic', align: 'right', cell: d => pct(d.clickThroughRate) },
        { key: 't', header: 'Confiance', align: 'right', cell: d => `${Math.round(d.trustScore)}/100` },
        { key: 'f', header: 'Campagnes', align: 'right', cell: d => formatNumber(d.campaignsCompleted) },
    ];
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <div className="w-56"><Select aria-label="Trier par" value={sortBy} onChange={e => { setSortBy(e.target.value as typeof sortBy); setPage(1); }}>
                    <option value="views">Plus grande audience</option><option value="clicks">Plus de clics</option><option value="trust">Plus fiables</option>
                </Select></div>
                <label className="flex items-center gap-2 text-sm font-semibold"><Switch label="Mesurés seulement" checked={measuredOnly} onChange={v => { setMeasuredOnly(v); setPage(1); }} />Mesurés seulement</label>
            </div>
            <p className="text-sm text-ink-2">« Déclarées » : le diffuseur n’a pas encore fini la campagne d’accueil, ses vues sont celles qu’il a annoncées. Ensuite elles sont mesurées. La confiance va de 0 à 100 (50 au départ, elle monte à chaque campagne terminée).</p>
            <DataList rows={q.data?.entries} columns={cols} rowKey={d => d.userId} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={setOpen} empty={<EmptyState title="Aucun diffuseur" />}
                card={d => (
                    <span className="flex items-center gap-3">
                        <span className="min-w-0 flex-1"><MemberLink id={d.userId} name={d.name} phone={d.phoneNumber} link={false} /></span>
                        <span className="text-right text-sm shrink-0"><span className="block font-semibold">{views(d)}</span><span className="block text-xs text-ink-3">confiance {Math.round(d.trustScore)}/100</span></span>
                    </span>
                )} />
            <Pagination page={page} totalPages={totalPages} total={q.data?.total} onChange={setPage} />

            {open && (
                <Sheet open onClose={() => setOpen(null)} title={open.name ?? 'Diffuseur'}
                    footer={<div className="grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => setAction('unban')}>Lever un bannissement</Button><Button variant="danger" onClick={() => setAction('ban')}>Bannir</Button></div>}>
                    <div className="space-y-4">
                        <MemberLink id={open.userId} name={open.name} phone={open.phoneNumber} />
                        <KeyValue items={[
                            ['Pays', countryName(open.country)],
                            ['Vues par statut', open.isMeasured ? `${formatNumber(Math.round(open.averageViews))} (mesurées)` : `${formatNumber(Math.round(open.averageViews))} (déclarées)`],
                            ['Vues vérifiées au total', formatNumber(open.totalVerifiedViews)],
                            ['Clics au total', formatNumber(open.totalClicks)],
                            ['Taux de clic', pct(open.clickThroughRate)],
                            ['Confiance', `${Math.round(open.trustScore)}/100`],
                            ['Campagnes terminées', formatNumber(open.campaignsCompleted)],
                        ]} />
                        <p className="text-xs text-ink-3">La liste n’indique pas si ce diffuseur est déjà banni : si l’action ne s’applique pas, le serveur le dira.</p>
                    </div>
                </Sheet>
            )}
            {open && (
                <>
                    <ConfirmSheet open={action === 'ban'} onClose={() => setAction(null)} tone="danger" title={`Bannir ${open.name ?? 'ce diffuseur'} ?`}
                        message={<p>Ses offres en attente sont retirées, ses campagnes en cours arrêtées, et il ne recevra plus d’offres. Le motif reste dans son dossier ; le bannissement peut être levé ici.</p>}
                        reason={{ label: 'Motif', suggestions: ['Vidéo truquée', 'Vues falsifiées', 'Code réutilisé', 'Publications non faites'], minLength: 5 }}
                        confirmLabel="Bannir" onConfirm={async (reason) => { const r = await ban(open.userId, reason); notify.success(r.data?.message || 'Diffuseur banni.'); setOpen(null); }} />
                    <ConfirmSheet open={action === 'unban'} onClose={() => setAction(null)} tone="success" title={`Lever le bannissement de ${open.name ?? 'ce diffuseur'} ?`}
                        message={<p>Il pourra de nouveau recevoir des offres. Le motif du bannissement reste dans son dossier.</p>}
                        confirmLabel="Lever le bannissement" onConfirm={async () => { await unban(open.userId); notify.success('Bannissement levé.'); setOpen(null); }} />
                </>
            )}
        </div>
    );
}
