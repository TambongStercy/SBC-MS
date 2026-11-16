import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import { getEventDashboard, listAdminDisputes } from '../api/event';
import { countOpenFraudFlags, countPendingChangeRequests } from '../components/eventAnimation/shared';

interface Dashboard {
    organizers: { pending: number; approved: number; suspended: number; total: number };
    // pendingReview / rejected: added with event review — absent on older deployments
    events: { draft: number; pendingReview?: number; rejected?: number; published: number; suspended: number; cancelled: number; completed: number; total: number };
    tickets: { issued: number; checkedIn: number; refunded: number; cancelled: number; total: number };
    orders: { paidCount: number; gross: number };
    commissions: { primary: { total: number; count: number }; resale: { total: number; count: number } };
    // added by a later backend version — absent on older deployments
    refunds?: { count: number; amount: number };
    resale: { active: number; sold: number; cancelled: number; volume?: number };
}

const xaf = (n?: number) => typeof n === 'number' ? `${n.toLocaleString('fr-FR')} XAF` : '—';

const StatCard = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
    <div className="bg-surface border border-line rounded-xl p-4">
        <div className="text-xs text-fg-muted uppercase">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {sub && <div className="text-xs text-fg-muted mt-1">{sub}</div>}
    </div>
);

/** Pending work outside the dashboard payload; each count is optional (an older backend just shows « — »). */
interface Queues { disputes?: number; fraud?: number; changes?: number }

/** One pending-work tile: highlighted when something waits, links to where it is handled. */
const TodoCard = ({ label, value, to, sub, tone = 'warning' }: { label: string; value?: number; to: string; sub?: string; tone?: 'warning' | 'danger' }) => {
    const waiting = !!value;
    const border = waiting ? (tone === 'danger' ? 'border-red-600' : 'border-amber-600') : 'border-line';
    return (
        <Link to={to} className={`block bg-surface border ${border} rounded-xl p-4 hover:bg-surface-2/60 transition-colors`}>
            <div className="text-xs text-fg-muted uppercase">{label}</div>
            <div className={`text-2xl font-bold mt-1 ${waiting ? (tone === 'danger' ? 'text-red-600 dark:text-red-300' : 'text-amber-700 dark:text-amber-300') : ''}`}>{value ?? '—'}</div>
            <div className="text-xs text-fg-muted mt-1">{sub ?? (waiting ? 'À traiter' : 'Rien en attente')}</div>
        </Link>
    );
};

export default function EventDashboardPage() {
    const [data, setData] = useState<Dashboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [queues, setQueues] = useState<Queues>({});

    useEffect(() => {
        // Each queue is loaded on its own so one failing endpoint never hides the others.
        const settle = <T,>(p: Promise<T>) => p.then(v => v, () => undefined);
        Promise.all([
            settle(listAdminDisputes({ status: 'OPEN', limit: 1 }).then(r => r.total)),
            settle(countOpenFraudFlags()),
            settle(countPendingChangeRequests()),
        ]).then(([disputes, fraud, changes]) => setQueues({ disputes, fraud, changes }));
    }, []);

    useEffect(() => {
        (async () => {
            try {
                setData(await getEventDashboard());
            } catch (e: unknown) {
                const err = e as { response?: { data?: { message?: string } }; message?: string };
                setError(err?.response?.data?.message || err?.message || 'Erreur');
            } finally { setLoading(false); }
        })();
    }, []);

    return (
        <div className="flex-1 overflow-y-auto">
            <Header title="SBC Event — Tableau de bord" />
            <div className="space-y-4">
                {loading && <Loader name="Chargement..." />}
                {error && <div className="bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl p-4">{error}</div>}
                {data && (
                    <>
                        <section className="space-y-2">
                            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">À traiter</h2>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                                <TodoCard label="Événements à valider" value={data.events.pendingReview} to="/event/events?status=PENDING_REVIEW"
                                    sub={data.events.rejected ? `${data.events.rejected} refusé(s) en attente de correction` : undefined} />
                                <TodoCard label="Organisateurs à approuver" value={data.organizers.pending} to="/event/organizers" />
                                <TodoCard label="Litiges ouverts" value={queues.disputes} to="/event/disputes" />
                                <TodoCard label="Animation : activités suspectes" value={queues.fraud} to="/event/animation?tab=a-verifier" tone="danger" />
                                <TodoCard label="Animation : demandes de modification" value={queues.changes} to="/event/animation?tab=demandes" />
                            </div>
                        </section>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <StatCard label="Organisateurs" value={data.organizers.total} sub={`${data.organizers.pending} en attente · ${data.organizers.approved} approuvés`} />
                            <StatCard label="Événements" value={data.events.total} sub={`${data.events.published} publiés · ${data.events.pendingReview ?? 0} à valider · ${data.events.draft} brouillons`} />
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
                            <StatCard label="Événements refusés" value={data.events.rejected ?? '—'} sub="En attente de correction par l'organisateur" />
                            <StatCard label="Billets remboursés" value={data.tickets.refunded} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
