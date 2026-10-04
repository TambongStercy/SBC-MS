import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getAdsAnalytics, getManualVerifications } from '../../../api/adsNetwork';
import { Card, ErrorState, Page, SectionTitle, Skeleton, Stat, Tabs } from '../../../ui';
import { formatCompact, formatMoney, formatNumber } from '../../../lib/format';
import { useParamState } from '../../../lib/hooks';
import { useChartColors } from '../../../lib/chartColors';
import { CampaignsTab } from './CampaignsTab';
import { DiffuseursTab } from './DiffuseursTab';
import { OnboardingTab } from './OnboardingTab';

const monthLabel = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    return Number.isFinite(y) && Number.isFinite(m) ? new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(new Date(y, m - 1, 1)) : key;
};

/** What's waiting, then the network's figures; every waiting count opens its list. */
function Overview() {
    const t = useChartColors();
    const a = useQuery({ queryKey: ['ads', 'analytics'], queryFn: () => getAdsAnalytics(12) });
    const proofs = useQuery({ queryKey: ['proofs'], queryFn: getManualVerifications });
    if (a.isError) return <ErrorState onRetry={() => a.refetch()} />;
    const d = a.data;
    const series = (d?.series ?? []).map(s => ({ ...s, label: monthLabel(s.month) }));
    return (
        <div className="space-y-5">
            <section>
                <SectionTitle>À traiter</SectionTitle>
                <div className="grid grid-cols-2 gap-2">
                    <Stat label="Campagnes à valider" value={formatNumber(d?.campaigns.pendingReview)} loading={a.isLoading} to="/modules/ads?onglet=campagnes&statut=a-valider" tone={d?.campaigns.pendingReview ? 'warning' : undefined} />
                    <Stat label="Vérifications vidéo" value={formatNumber(proofs.data?.length)} loading={proofs.isLoading} to="/a-traiter/verifications" tone={proofs.data?.length ? 'warning' : undefined} />
                </div>
            </section>
            <section>
                <SectionTitle>Argent</SectionTitle>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <Stat label="Revenus" value={formatMoney(d?.money.revenue)} hint={d ? `${formatMoney(d.money.revenueThisMonth)} ce mois` : undefined} loading={a.isLoading} />
                    <Stat label="Versé aux diffuseurs" value={formatMoney(d?.money.paidToDiffuseurs)} hint={d ? `${formatNumber(d.money.participationsPaid)} participations` : undefined} loading={a.isLoading} />
                    <Stat label="Marge brute" value={formatMoney(d?.money.grossMargin)} loading={a.isLoading} />
                    <Stat label="Campagnes" value={formatNumber(d?.campaigns.total)} hint={d ? `${d.campaigns.launchedThisMonth} lancées, ${d.campaigns.completedThisMonth} terminées ce mois` : undefined} loading={a.isLoading} to="/modules/ads?onglet=campagnes" />
                </div>
            </section>
            <section>
                <SectionTitle>Réseau</SectionTitle>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <Stat label="Annonceurs" value={formatNumber(d?.annonceurs.total)} hint={d ? `+${d.annonceurs.newThisMonth} ce mois` : undefined} loading={a.isLoading} />
                    <Stat label="Diffuseurs" value={formatNumber(d?.diffuseurs.total)} hint={d ? `+${d.diffuseurs.newThisMonth} ce mois` : undefined} loading={a.isLoading} to="/modules/ads?onglet=diffuseurs" />
                    <Stat label="Vues uniques" value={formatCompact(d?.delivery.uniqueViews)} hint={d ? `${formatCompact(d.delivery.totalViews)} au total` : undefined} loading={a.isLoading} />
                    <Stat label="Clics" value={formatCompact(d?.delivery.clicks)} loading={a.isLoading} />
                </div>
            </section>
            <section>
                <SectionTitle>Revenus par mois</SectionTitle>
                <Card>
                    {a.isLoading ? <Skeleton className="h-56" /> : (
                        <div className="h-56"><ResponsiveContainer width="100%" height="100%">
                            <BarChart data={series} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                                <CartesianGrid stroke={t.grid} vertical={false} />
                                <XAxis dataKey="label" stroke={t.ink} fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke={t.ink} fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => formatCompact(v)} width={44} />
                                <Tooltip formatter={(v: number) => [formatMoney(v), 'Revenus']} contentStyle={{ borderRadius: 12, border: `1px solid ${t.grid}`, fontSize: 13 }} cursor={{ fill: t.grid, opacity: 0.4 }} />
                                <Bar dataKey="revenue" fill={t.accent} radius={[6, 6, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer></div>
                    )}
                </Card>
            </section>
        </div>
    );
}

/** SBC Ads Network: campaigns annonceurs pay for, posted on diffuseurs' WhatsApp statuses. */
export default function AdsModule() {
    const [tab, setTab] = useParamState('onglet', 'apercu');
    return (
        <Page title="Ads Network" back="/modules" width="wide">
            <div className="space-y-4">
                <Tabs value={tab} onChange={setTab} phoneColumns={2} items={[
                    { value: 'apercu', label: 'Aperçu' }, { value: 'campagnes', label: 'Campagnes' },
                    { value: 'diffuseurs', label: 'Diffuseurs' }, { value: 'reglages', label: 'Campagne d’accueil' },
                ]} />
                {tab === 'campagnes' ? <CampaignsTab /> : tab === 'diffuseurs' ? <DiffuseursTab /> : tab === 'reglages' ? <OnboardingTab /> : <Overview />}
            </div>
        </Page>
    );
}
