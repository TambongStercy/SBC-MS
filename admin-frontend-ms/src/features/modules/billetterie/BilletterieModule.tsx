import { useQuery } from '@tanstack/react-query';
import { getEventDashboard } from '../../../api/event';
import { ErrorState, Page, SectionTitle, Stat, Tabs } from '../../../ui';
import { formatMoney, formatNumber } from '../../../lib/format';
import { useParamState } from '../../../lib/hooks';
import { OrganizersTab } from './OrganizersTab';
import { EventsTab } from './EventsTab';
import { OrdersTab } from './OrdersTab';
import { ResaleTab } from './ResaleTab';
import { DisputesTab } from './DisputesTab';
import { SettingsTab } from './SettingsTab';

type Dash = {
    organizers: { pending: number; approved: number; suspended: number; total: number };
    events: { draft: number; published: number; suspended: number; cancelled: number; completed: number; total: number };
    tickets: { issued: number; checkedIn: number; refunded: number; total: number };
    orders: { paidCount: number; gross: number };
    commissions: { primary: { total: number; count: number }; resale: { total: number; count: number } };
    resale: { active: number; sold: number; salesCount: number; salesVolume: number };
    refunds: { count: number; total: number; pending: number; failed: number };
};

function Overview({ go }: { go: (tab: string) => void }) {
    const q = useQuery({ queryKey: ['events', 'dashboard'], queryFn: async (): Promise<Dash> => getEventDashboard() });
    if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
    const d = q.data;
    const L = q.isLoading;
    return (
        <div className="space-y-5">
            <section>
                <SectionTitle>À traiter</SectionTitle>
                <div className="grid grid-cols-2 gap-2">
                    <button type="button" className="text-left" onClick={() => go('organisateurs')}><Stat label="Organisateurs en attente" value={formatNumber(d?.organizers.pending)} loading={L} tone={d?.organizers.pending ? 'warning' : undefined} /></button>
                    <Stat label="Remboursements en échec" value={formatNumber(d?.refunds.failed)} loading={L} tone={d?.refunds.failed ? 'danger' : undefined} hint={d?.refunds.pending ? `${d.refunds.pending} en cours · retentés automatiquement` : 'retentés automatiquement'} />
                </div>
            </section>
            <section>
                <SectionTitle>Ventes</SectionTitle>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <Stat label="Commandes payées" value={formatNumber(d?.orders.paidCount)} hint={d ? formatMoney(d.orders.gross) : undefined} loading={L} />
                    <Stat label="Commissions SBC" value={d ? formatMoney(d.commissions.primary.total + d.commissions.resale.total) : '—'} hint={d ? `dont ${formatMoney(d.commissions.resale.total)} sur les reventes` : undefined} loading={L} />
                    <Stat label="Billets valables" value={formatNumber(d?.tickets.issued)} hint={d ? `${formatNumber(d.tickets.checkedIn)} déjà entrés` : undefined} loading={L} />
                    <Stat label="Remboursés" value={d ? formatMoney(d.refunds.total) : '—'} hint={d ? `${formatNumber(d.refunds.count)} commandes` : undefined} loading={L} />
                </div>
            </section>
            <section>
                <SectionTitle>Catalogue</SectionTitle>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <button type="button" className="text-left" onClick={() => go('evenements')}><Stat label="Événements en vente" value={formatNumber(d?.events.published)} hint={d ? `${d.events.draft} brouillons · ${d.events.suspended} suspendus` : undefined} loading={L} /></button>
                    <button type="button" className="text-left" onClick={() => go('organisateurs')}><Stat label="Organisateurs" value={formatNumber(d?.organizers.approved)} hint={d ? `${d.organizers.suspended} suspendus` : undefined} loading={L} /></button>
                    <button type="button" className="text-left" onClick={() => go('revente')}><Stat label="Annonces de revente" value={formatNumber(d?.resale.active)} hint={d ? `${formatNumber(d.resale.salesCount)} reventes · ${formatMoney(d.resale.salesVolume)}` : undefined} loading={L} /></button>
                    <Stat label="Événements passés" value={formatNumber(d?.events.completed)} hint={d ? `${d.events.cancelled} annulés` : undefined} loading={L} />
                </div>
            </section>
        </div>
    );
}

/** SBC Event: organisers sell tickets; members buy and resell them. */
export default function BilletterieModule() {
    const [tab, setTab] = useParamState('onglet', 'apercu');
    return (
        <Page title="Billetterie" back="/modules" width="wide">
            <div className="space-y-4">
                <Tabs value={tab} onChange={setTab} phoneColumns={3} items={[
                    { value: 'apercu', label: 'Aperçu' }, { value: 'organisateurs', label: 'Organisateurs' }, { value: 'evenements', label: 'Événements' },
                    { value: 'commandes', label: 'Commandes' }, { value: 'revente', label: 'Revente' }, { value: 'litiges', label: 'Litiges' }, { value: 'reglages', label: 'Commissions' },
                ]} />
                {tab === 'organisateurs' ? <OrganizersTab /> : tab === 'evenements' ? <EventsTab /> : tab === 'commandes' ? <OrdersTab />
                    : tab === 'revente' ? <ResaleTab /> : tab === 'litiges' ? <DisputesTab /> : tab === 'reglages' ? <SettingsTab /> : <Overview go={setTab} />}
            </div>
        </Page>
    );
}
