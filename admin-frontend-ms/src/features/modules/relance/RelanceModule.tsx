import { useQuery } from '@tanstack/react-query';
import { ErrorState, Page, SectionTitle, Stat, Tabs } from '../../../ui';
import { formatMoney, formatNumber } from '../../../lib/format';
import { useParamState } from '../../../lib/hooks';
import { getOverview, plural } from './api';
import { CampaignsTab } from './CampaignsTab';
import { ParrainsTab } from './ParrainsTab';
import { EmailsTab } from './EmailsTab';
import { SmsTab } from './SmsTab';

function Intro({ children }: { children: React.ReactNode }) {
    return <p className="-mt-1 mb-2 text-sm text-ink-2">{children}</p>;
}

function Overview() {
    const q = useQuery({ queryKey: ['relance', 'overview'], queryFn: getOverview });
    if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
    const d = q.data;
    const L = q.isLoading;
    const c = d?.campaigns.byStatus;
    return (
        <div className="space-y-6">
            <section>
                <SectionTitle>Relance des nouveaux</SectionTitle>
                <Intro>Chaque nouveau filleul reçoit un message par jour pendant 7 jours, tant qu’il n’a pas payé.</Intro>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <Stat label="Filleuls en cours" value={formatNumber(d?.nouveaux.active)} loading={L} />
                    <Stat label="Entrés aujourd’hui" value={formatNumber(d?.nouveaux.enrolledToday)} loading={L} />
                    <Stat label="Ont payé (30 j)" value={formatNumber(d?.nouveaux.paidLast30Days)} loading={L} tone="success" />
                    <Stat label="7 jours finis sans payer (30 j)" value={formatNumber(d?.nouveaux.finishedLast30Days)} loading={L} />
                </div>
            </section>
            <section>
                <SectionTitle>Campagnes de relance</SectionTitle>
                <Intro>Un parrain choisit d’anciens filleuls et les fait passer par les mêmes 7 jours.</Intro>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <Stat label="Campagnes en cours" value={formatNumber(c?.active ?? 0)} loading={L} to="/modules/relance?onglet=campagnes&statut=active"
                        hint={d ? `${formatNumber(d.campaigns.activeTargets)} filleuls en cours` : undefined} />
                    <Stat label="En pause" value={formatNumber(c?.paused ?? 0)} loading={L} to="/modules/relance?onglet=campagnes&statut=paused" tone={c?.paused ? 'warning' : undefined} />
                    <Stat label="Programmées" value={formatNumber(c?.scheduled ?? 0)} loading={L} hint={d ? plural(c?.draft ?? 0, 'brouillon') : undefined} />
                    <Stat label="Terminées" value={formatNumber(c?.completed ?? 0)} loading={L} hint={d ? plural(c?.cancelled ?? 0, 'annulée') : undefined} />
                </div>
            </section>
            <section>
                <SectionTitle>Envois</SectionTitle>
                <div className="grid grid-cols-3 gap-2">
                    <Stat label="E-mails aujourd’hui" value={formatNumber(d?.sends.today.email)} loading={L} hint={d ? `${formatNumber(d.sends.last7Days.email)} en 7 j` : undefined} />
                    <Stat label="SMS aujourd’hui" value={formatNumber(d?.sends.today.sms)} loading={L} hint={d ? `${formatNumber(d.sends.last7Days.sms)} en 7 j` : undefined} />
                    <Stat label="Échecs aujourd’hui" value={formatNumber(d?.sends.today.failed)} loading={L} tone={d?.sends.today.failed ? 'danger' : undefined} hint={d ? `${formatNumber(d.sends.last7Days.failed)} en 7 j` : undefined} />
                </div>
            </section>
            <section>
                <SectionTitle>Crédits des parrains</SectionTitle>
                <Intro>Chaque message envoyé consomme un crédit du parrain. Sans crédit, rien ne part.</Intro>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <Stat label="Parrains avec crédits" value={formatNumber(d?.credits.parrainsWithCredits)} loading={L} to="/modules/relance?onglet=parrains" />
                    <Stat label="Crédits e-mail restants" value={formatNumber(d?.credits.emailLeft)} loading={L} />
                    <Stat label="Crédits SMS restants" value={formatNumber(d?.credits.smsLeft)} loading={L} />
                    <Stat label="Packs achetés" value={formatNumber(d?.packs.total.count)} loading={L}
                        hint={d ? `${formatMoney(d.packs.total.amountXAF)} · ${formatNumber(d.packs.last30Days.count)} en 30 j` : undefined} />
                </div>
            </section>
        </div>
    );
}

/** Relance: the automatic follow-up of filleuls who haven't paid, and what it sends. */
export default function RelanceModule() {
    const [tab, setTab] = useParamState('onglet', 'apercu');
    return (
        <Page title="Relance des filleuls" width="wide">
            <div className="space-y-4">
                <Tabs value={tab} onChange={setTab} phoneColumns={3} items={[
                    { value: 'apercu', label: 'Aperçu' }, { value: 'campagnes', label: 'Campagnes' }, { value: 'parrains', label: 'Parrains' },
                    { value: 'emails', label: 'E-mails' }, { value: 'sms', label: 'SMS' },
                ]} />
                {tab === 'campagnes' ? <CampaignsTab /> : tab === 'parrains' ? <ParrainsTab /> : tab === 'emails' ? <EmailsTab />
                    : tab === 'sms' ? <SmsTab /> : <Overview />}
            </div>
        </Page>
    );
}
