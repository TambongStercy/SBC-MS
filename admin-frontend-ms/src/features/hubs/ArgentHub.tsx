import { ArrowDownUp, Banknote, BarChart3, CreditCard, History, Hourglass, LifeBuoy, ListChecks } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useQueueCounts } from '../home/queues';
import { NavList, NavRow, Page, SectionTitle } from '../../ui';

const Count = ({ n }: { n?: number }) =>
    n ? <span className="rounded-pill bg-primary px-2 py-0.5 text-xs font-bold text-white tabular">{n}</span> : null;

/** Argent: withdrawals first (the daily work), then payments and repair tools. */
export default function ArgentHub() {
    const { role } = useAuth();
    const { defs, results } = useQueueCounts(role);
    const count = (key: string) => results[defs.findIndex(d => d.key === key)]?.data?.count;
    const isAdmin = role === 'admin';

    return (
        <Page title="Argent">
            <div className="space-y-6">
                <section>
                    <SectionTitle>Retraits</SectionTitle>
                    <NavList>
                        <NavRow to="/a-traiter/retraits" icon={<Banknote size={20} />} tone="success" title="À valider" description="Un par un, avec tout pour décider" trailing={<Count n={count('withdrawals')} />} />
                        <NavRow to="/withdrawals/approvals" icon={<ListChecks size={20} />} title="Liste et validation groupée" description="Filtrer, cocher plusieurs retraits" />
                        <NavRow to="/argent/bloques" icon={<Hourglass size={20} />} tone="danger" title="Bloqués chez le fournisseur" description="MoneyFusion et CinetPay sans réponse" trailing={<Count n={count('stuck')} />} />
                        <NavRow to="/withdrawals/history" icon={<History size={20} />} tone="neutral" title="Historique" description="Retraits payés, refusés, échoués" />
                    </NavList>
                </section>
                {isAdmin && (
                    <section>
                        <SectionTitle>Paiements</SectionTitle>
                        <NavList>
                            <NavRow to="/transactions" icon={<CreditCard size={20} />} title="Paiements" description="Abonnements, packs, billets, campagnes" />
                            <NavRow to="/account-transactions" icon={<ArrowDownUp size={20} />} tone="neutral" title="Mouvements de solde" description="Tout ce qui entre et sort des soldes" />
                            <NavRow to="/manual-payment-recovery" icon={<LifeBuoy size={20} />} tone="warning" title="Récupérer un abonnement payé" description="Quand un membre a payé sans être abonné" />
                            <NavRow to="/user-analytics" icon={<BarChart3 size={20} />} tone="accent" title="Plus gros gains et retraits" description="Classement des membres par montants" />
                        </NavList>
                    </section>
                )}
            </div>
        </Page>
    );
}
