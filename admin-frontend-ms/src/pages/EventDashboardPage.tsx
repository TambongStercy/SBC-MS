import { useEffect, useState } from 'react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import { getEventDashboard } from '../api/event';

interface Dashboard {
    organizers: { pending: number; approved: number; suspended: number; total: number };
    events: { draft: number; published: number; suspended: number; cancelled: number; completed: number; total: number };
    tickets: { issued: number; checkedIn: number; refunded: number; cancelled: number; total: number };
    orders: { paidCount: number; gross: number };
    commissions: { primary: { total: number; count: number }; resale: { total: number; count: number } };
    // added by a later backend version — absent on older deployments
    refunds?: { count: number; amount: number };
    resale: { active: number; sold: number; cancelled: number; volume?: number };
}

const xaf = (n?: number) => typeof n === 'number' ? `${n.toLocaleString('fr-FR')} XAF` : '—';

const StatCard = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-xs text-gray-500 uppercase">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
);

export default function EventDashboardPage() {
    const [data, setData] = useState<Dashboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                setData(await getEventDashboard());
            } catch (e: any) {
                setError(e?.response?.data?.message || e?.message || 'Erreur');
            } finally { setLoading(false); }
        })();
    }, []);

    return (
        <div className="flex-1 overflow-y-auto">
            <Header title="SBC Event — Tableau de bord" />
            <div className="p-6 space-y-4">
                {loading && <Loader name="Chargement..." />}
                {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">{error}</div>}
                {data && (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <StatCard label="Organisateurs" value={data.organizers.total} sub={`${data.organizers.pending} en attente · ${data.organizers.approved} approuvés`} />
                            <StatCard label="Événements" value={data.events.total} sub={`${data.events.published} publiés · ${data.events.draft} brouillons`} />
                            <StatCard label="Billets" value={data.tickets.total} sub={`${data.tickets.issued} émis · ${data.tickets.checkedIn} entrés`} />
                            <StatCard label="Commandes payées" value={data.orders.paidCount} sub={`CA: ${(data.orders.gross).toLocaleString('fr-FR')} XAF`} />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            <StatCard label="Commissions primaires" value={`${data.commissions.primary.total.toLocaleString('fr-FR')} XAF`} sub={`${data.commissions.primary.count} règlements`} />
                            <StatCard label="Commissions revente" value={`${data.commissions.resale.total.toLocaleString('fr-FR')} XAF`} sub={`${data.commissions.resale.count} règlements`} />
                            <StatCard label="Marketplace revente" value={data.resale.active} sub={`${data.resale.sold} revendus · ${data.resale.cancelled} annulés`} />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            <StatCard
                                label="Remboursements"
                                value={data.refunds ? data.refunds.count : '—'}
                                sub={`Montant: ${xaf(data.refunds?.amount)}`}
                            />
                            <StatCard label="Volume des reventes" value={xaf(data.resale.volume)} sub={`${data.resale.sold} billets revendus`} />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            <StatCard label="Événements suspendus" value={data.events.suspended} />
                            <StatCard label="Événements annulés" value={data.events.cancelled} />
                            <StatCard label="Billets remboursés" value={data.tickets.refunded} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
