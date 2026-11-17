import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    ArrowRight01Icon, CreditCardIcon, Mail01Icon, MoneyReceive02Icon, RefreshIcon, SentIcon, ShoppingCart01Icon, UserAdd01Icon,
} from '@hugeicons/core-free-icons';
import {
    getActiveConfigs, getActiveTargets, getAdminOverview, getBalance, getStats,
} from '../services/adminRelanceApi';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { Can } from '../components/Can';
import {
    Badge, Button, EmptyState, Metric, PageHeader, Panel, PanelBody, PanelHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger,
} from '../components/ui';
import { ErrorState } from '../components/display/ErrorState';
import { RelativeDate } from '../components/display/RelativeDate';
import { apiError, fmtInt, fmtPct, fmtXaf } from '../components/display/format';
import { useUrlParams } from '../components/display/useUrlParams';
import { RankedBars } from '../components/storage/RankedBars';
import { CAMPAIGN_STATUS, CampaignStatusBadge, EXIT_REASON_LABELS, TargetStatusBadge } from '../components/relance/labels';
import { BuyCreditsDialog } from '../components/relance/BuyCreditsDialog';
import { ParrainsPanel } from '../components/relance/ParrainsPanel';

const WHATSAPP_LABELS: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
    connected: { label: 'Connecté', tone: 'success' },
    connecting: { label: 'Connexion…', tone: 'warning' },
    disconnected: { label: 'Déconnecté', tone: 'neutral' },
    failed: { label: 'Échec', tone: 'danger' },
};

const packs = (p: { count: number; amountXAF: number }) =>
    `${fmtInt(p.count)} pack${p.count > 1 ? 's' : ''}${p.amountXAF > 0 ? ` · ${fmtXaf(p.amountXAF)}` : ''}`;

/** Line in a figure list: label left, figure right. */
function Line({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <dt className="text-fg-muted">{label}{hint && <span className="block text-xs text-fg-subtle">{hint}</span>}</dt>
            <dd className="shrink-0 font-medium text-fg tabular-nums">{value}</dd>
        </div>
    );
}

/**
 * Relance — overview. Two products share the name (CLAUDE.md): « relance des
 * nouveaux » (a new filleul gets one message a day for 7 days until he pays)
 * and « campagnes » (a parrain pushes his older filleuls through the same 7
 * days). Counted apart here, from GET /relance/admin/overview; the older
 * /stats (both products together) stays below.
 */
export default function RelanceDashboardPage() {
    const queryClient = useQueryClient();
    const filters = usePageFilters();
    const params = filters.apiParams;
    const url = useUrlParams({ page: '1' });
    const page = Math.max(1, Number(url.get('page')) || 1);
    const [buyOpen, setBuyOpen] = useState(false);

    const overview = useQuery({ queryKey: ['relance-overview', params], queryFn: () => getAdminOverview(params), placeholderData: keepPreviousData });
    const stats = useQuery({ queryKey: ['relance-stats', params], queryFn: () => getStats(params), placeholderData: keepPreviousData });
    const targets = useQuery({ queryKey: ['relance-active-targets', params], queryFn: () => getActiveTargets(1, 10, params), placeholderData: keepPreviousData });
    const configs = useQuery({ queryKey: ['relance-active-configs', params], queryFn: () => getActiveConfigs(params), placeholderData: keepPreviousData });
    // The signed-in admin's own relance account (member endpoint).
    const balance = useQuery({ queryKey: ['relance-own-balance'], queryFn: getBalance, retry: false });

    const refresh = () => void queryClient.invalidateQueries({
        predicate: q => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('relance-'),
    });
    const refreshing = overview.isFetching || stats.isFetching;

    const o = overview.data;
    const s = stats.data;
    const sentToday = o ? o.sends.today.email + o.sends.today.sms : 0;
    const sent7 = o ? o.sends.last7Days.email + o.sends.last7Days.sms : 0;
    const exits30 = o ? o.nouveaux.paidLast30Days + o.nouveaux.finishedLast30Days : 0;
    const paidRate = o && exits30 > 0 ? (o.nouveaux.paidLast30Days / exits30) * 100 : null;
    const paused = o?.campaigns.byStatus.paused ?? 0;
    const scheduled = o?.campaigns.byStatus.scheduled ?? 0;
    const stale = overview.isFetching && !overview.isLoading ? 'opacity-60 transition-opacity' : undefined;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Relance"
                description="Les e-mails et SMS qui poussent les filleuls à payer : relance des nouveaux, campagnes des parrains, crédits."
                actions={(
                    <>
                        <Button size="lg" className="flex-1 sm:flex-none" onClick={refresh} loading={refreshing}>
                            {!refreshing && <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />}
                            Actualiser
                        </Button>
                        <Button asChild variant="primary" size="lg" className="flex-1 sm:flex-none">
                            <Link to="/relance/campaigns">
                                Campagnes
                                <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
                            </Link>
                        </Button>
                    </>
                )}
            />

            <PageFilters filters={filters} />

            {overview.isError ? (
                <Panel><ErrorState message={apiError(overview.error, 'Le tableau de bord n’a pas pu être chargé.')} onRetry={() => void overview.refetch()} retrying={overview.isFetching} /></Panel>
            ) : (
                <>
                    {(paused > 0 || scheduled > 0) && (
                        <Panel className="border-warning/40 bg-warning-soft/40" role="status">
                            <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                                <div>
                                    <p className="text-sm font-medium text-fg">À surveiller</p>
                                    <p className="mt-0.5 text-sm text-fg-muted">
                                        {[paused > 0 && `${fmtInt(paused)} campagne${paused > 1 ? 's' : ''} en pause`, scheduled > 0 && `${fmtInt(scheduled)} programmée${scheduled > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
                                    </p>
                                </div>
                                <Button asChild size="lg">
                                    <Link to={`/relance/campaigns?statut=${paused > 0 ? 'paused' : 'scheduled'}`}>Voir ces campagnes</Link>
                                </Button>
                            </div>
                        </Panel>
                    )}

                    <div className={`grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4 ${stale ?? ''}`}>
                        <Metric
                            label="Nouveaux en relance"
                            icon={UserAdd01Icon}
                            tone="primary"
                            value={o ? fmtInt(o.nouveaux.active) : <Skeleton className="h-8 w-20" />}
                            hint={o ? `${fmtInt(o.nouveaux.enrolledToday)} entrés aujourd’hui` : undefined}
                        />
                        <Metric
                            label="Ont payé (30 j)"
                            icon={MoneyReceive02Icon}
                            tone="success"
                            value={o ? fmtInt(o.nouveaux.paidLast30Days) : <Skeleton className="h-8 w-20" />}
                            hint={o ? (paidRate === null ? 'Aucune sortie sur 30 j' : `${fmtPct(paidRate)} des sorties · ${fmtInt(o.nouveaux.finishedLast30Days)} sans payer`) : undefined}
                        />
                        <Metric
                            label="Envoyés aujourd’hui"
                            icon={SentIcon}
                            value={o ? fmtInt(sentToday) : <Skeleton className="h-8 w-20" />}
                            hint={o ? `${fmtInt(sent7)} sur 7 j · ${fmtInt(o.sends.last7Days.failed)} échecs` : undefined}
                        />
                        <Metric
                            label="Crédits e-mail restants"
                            icon={CreditCardIcon}
                            value={o ? fmtInt(o.credits.emailLeft) : <Skeleton className="h-8 w-20" />}
                            hint={o ? `Tous parrains · ${fmtInt(o.credits.smsLeft)} SMS · ${fmtInt(o.credits.parrainsWithCredits)} parrain${o.credits.parrainsWithCredits > 1 ? 's' : ''} avec crédits` : undefined}
                        />
                    </div>

                    <div className={`grid grid-cols-1 gap-6 lg:grid-cols-2 ${stale ?? ''}`}>
                        <Panel>
                            <PanelHeader title="Relance des nouveaux" description="Un message par jour pendant 7 jours après l’inscription, jusqu’au paiement." />
                            <PanelBody>
                                {o ? (
                                    <dl className="divide-y divide-line">
                                        <Line label="Dans la boucle" value={fmtInt(o.nouveaux.active)} />
                                        <Line label="Entrés aujourd’hui" value={fmtInt(o.nouveaux.enrolledToday)} />
                                        <Line label="Sortis en payant (30 j)" value={fmtInt(o.nouveaux.paidLast30Days)} />
                                        <Line label="Sortis après les 7 jours (30 j)" value={fmtInt(o.nouveaux.finishedLast30Days)} />
                                    </dl>
                                ) : <Skeleton className="h-36 w-full" />}
                            </PanelBody>
                        </Panel>
                        <Panel>
                            <PanelHeader
                                title="Campagnes de relance"
                                description="Un parrain pousse ses anciens filleuls dans les mêmes 7 jours."
                                actions={<Button asChild variant="ghost" size="sm"><Link to="/relance/campaigns">Tout voir</Link></Button>}
                            />
                            <PanelBody>
                                {o ? (
                                    <dl className="divide-y divide-line">
                                        <Line label="Filleuls en cours dans une campagne" value={fmtInt(o.campaigns.activeTargets)} />
                                        {Object.keys(CAMPAIGN_STATUS).filter(k => (o.campaigns.byStatus[k] ?? 0) > 0).map(k => (
                                            <div key={k} className="flex items-center justify-between gap-3 py-2 text-sm">
                                                <dt><Link to={`/relance/campaigns?statut=${k}`} className="hover:underline"><CampaignStatusBadge status={k} /></Link></dt>
                                                <dd className="font-medium text-fg tabular-nums">{fmtInt(o.campaigns.byStatus[k])}</dd>
                                            </div>
                                        ))}
                                        {Object.values(o.campaigns.byStatus).every(n => !n) && (
                                            <p className="py-2 text-sm text-fg-muted">Aucune campagne sur la période.</p>
                                        )}
                                    </dl>
                                ) : <Skeleton className="h-36 w-full" />}
                            </PanelBody>
                        </Panel>
                    </div>

                    <div className={`grid grid-cols-1 gap-6 lg:grid-cols-2 ${stats.isFetching && !stats.isLoading ? 'opacity-60 transition-opacity' : ''}`}>
                        <Panel>
                            <PanelHeader title="Pourquoi les filleuls sortent de la boucle" description="Nouveaux et campagnes, entrés sur la période." />
                            <PanelBody>
                                {stats.isError ? (
                                    <ErrorState message={apiError(stats.error, 'Les statistiques n’ont pas pu être chargées.')} onRetry={() => void stats.refetch()} retrying={stats.isFetching} className="py-6" />
                                ) : s ? (
                                    Object.values(s.exitReasons).every(n => !n) ? (
                                        <p className="py-6 text-center text-sm text-fg-muted">Aucune sortie sur la période.</p>
                                    ) : (
                                        <RankedBars
                                            label="Motifs de sortie"
                                            unitHeader="Filleuls"
                                            format={n => fmtInt(n)}
                                            data={Object.entries(s.exitReasons).map(([key, value]) => ({ key, label: EXIT_REASON_LABELS[key] ?? key, value }))}
                                        />
                                    )
                                ) : <Skeleton className="h-40 w-full" />}
                            </PanelBody>
                        </Panel>
                        <Panel>
                            <PanelHeader title="Envois et ventes" description="Messages des 7 derniers jours et packs de crédits achetés par les parrains." />
                            <PanelBody>
                                {o && s ? (
                                    <dl className="divide-y divide-line">
                                        <Line label="E-mails envoyés (7 j)" value={fmtInt(o.sends.last7Days.email)} />
                                        <Line label="SMS envoyés (7 j)" value={fmtInt(o.sends.last7Days.sms)} />
                                        {/* The /stats success rate reads a legacy `success` flag the sender no longer writes: left out. */}
                                        <Line label="Messages envoyés sur la période" value={fmtInt(s.totalMessagesSent)} />
                                        <Line label="Packs achetés (30 j)" value={packs(o.packs.last30Days)} />
                                        <Line label="Packs achetés sur la période" value={packs(o.packs.total)} hint="Les crédits offerts avec le Pack Winner comptent sans montant." />
                                        <Line label="Parrains avec la relance activée" value={fmtInt(s.activeConfigsCount)} />
                                    </dl>
                                ) : <Skeleton className="h-48 w-full" />}
                            </PanelBody>
                        </Panel>
                    </div>
                </>
            )}

            <ParrainsPanel filters={params} page={page} onPageChange={p => url.set({ page: String(p) })} />

            <Panel>
                <PanelHeader title="Détails" description="Dernières entrées dans la boucle et comptes relance actifs (identifiants techniques)." />
                <Tabs defaultValue="targets" className="px-5 pb-5">
                    <TabsList className="pb-px [scrollbar-width:none]">
                        <TabsTrigger value="targets">Dernières entrées{targets.data ? ` (${fmtInt(targets.data.total)})` : ''}</TabsTrigger>
                        <TabsTrigger value="configs">Comptes actifs{configs.data ? ` (${fmtInt(configs.data.length)})` : ''}</TabsTrigger>
                        <TabsTrigger value="own">Ce compte admin</TabsTrigger>
                    </TabsList>
                    <TabsContent value="targets" className="pt-4">
                        {targets.isLoading ? <Skeleton className="h-32 w-full" /> : targets.isError ? (
                            <ErrorState message={apiError(targets.error, 'La liste n’a pas pu être chargée.')} onRetry={() => void targets.refetch()} className="py-6" />
                        ) : !targets.data?.targets.length ? (
                            <EmptyState icon={UserAdd01Icon} title="Personne dans la boucle" description="Aucun filleul n’est entré dans une relance sur la période." className="py-8" />
                        ) : (
                            <ul className="divide-y divide-line">
                                {targets.data.targets.map(t => (
                                    <li key={t._id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-fg">Jour {t.currentDay}/7</span>
                                            <TargetStatusBadge status={t.status} />
                                        </div>
                                        <p className="text-xs text-fg-muted">
                                            Entré <RelativeDate value={t.enteredLoopAt} /> · prochain message <RelativeDate value={t.nextMessageDue} /> · {fmtInt(t.messagesDelivered.length)} remis
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </TabsContent>
                    <TabsContent value="configs" className="pt-4">
                        {configs.isLoading ? <Skeleton className="h-32 w-full" /> : configs.isError ? (
                            <ErrorState message={apiError(configs.error, 'La liste n’a pas pu être chargée.')} onRetry={() => void configs.refetch()} className="py-6" />
                        ) : !configs.data?.length ? (
                            <EmptyState icon={Mail01Icon} title="Aucun compte actif" className="py-8" />
                        ) : (
                            <>
                                <p className="mb-2 text-xs text-fg-muted">Le statut WhatsApp vient de l’ancienne relance par WhatsApp ; les noms sont dans « Parrains » ci-dessus.</p>
                                <ul className="divide-y divide-line">
                                    {configs.data.map(c => {
                                        const wa = WHATSAPP_LABELS[c.whatsappStatus] ?? { label: c.whatsappStatus, tone: 'neutral' as const };
                                        return (
                                            <li key={c._id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-mono text-xs text-fg-muted">{c.userId}</span>
                                                    <Badge tone={wa.tone}>WhatsApp : {wa.label}</Badge>
                                                    {c.enrollmentPaused && <Badge tone="warning">Inscriptions en pause</Badge>}
                                                    {c.sendingPaused && <Badge tone="danger">Envoi en pause</Badge>}
                                                </div>
                                                <p className="text-xs text-fg-muted tabular-nums">{fmtInt(c.messagesSentToday)} envoyés aujourd’hui</p>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </>
                        )}
                    </TabsContent>
                    <TabsContent value="own" className="pt-4">
                        {balance.isLoading ? <Skeleton className="h-20 w-full" /> : balance.data ? (
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <dl className="flex gap-8">
                                    <div><dt className="text-xs text-fg-muted">Crédits e-mail</dt><dd className="text-xl font-semibold text-fg">{fmtInt(balance.data.emailBalance)}</dd></div>
                                    {balance.data.smsEnabled && <div><dt className="text-xs text-fg-muted">Crédits SMS</dt><dd className="text-xl font-semibold text-fg">{fmtInt(balance.data.smsBalance)}</dd></div>}
                                </dl>
                                <Can module="relance" write>
                                    <Button size="lg" onClick={() => setBuyOpen(true)}>
                                        <HugeiconsIcon icon={ShoppingCart01Icon} size={16} aria-hidden="true" />
                                        Acheter des crédits
                                    </Button>
                                </Can>
                            </div>
                        ) : (
                            <p className="text-sm text-fg-muted">Ce compte n’a pas de compte relance.</p>
                        )}
                    </TabsContent>
                </Tabs>
            </Panel>

            <BuyCreditsDialog open={buyOpen} onOpenChange={setBuyOpen} smsAllowed={!!balance.data?.smsEnabled} />
        </div>
    );
}
