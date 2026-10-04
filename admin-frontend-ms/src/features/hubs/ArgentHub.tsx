import { ArrowDownUp, Banknote, BarChart3, CreditCard, History, Hourglass, LifeBuoy, ListChecks, Landmark } from 'lucide-react';
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
                        <NavRow to="/argent/retraits" icon={<ListChecks size={20} />} title="Liste et validation groupée" description="Cocher plusieurs retraits et les valider ensemble" />
                        <NavRow to="/argent/bloques" icon={<Hourglass size={20} />} tone="danger" title="Bloqués chez le fournisseur" description="MoneyFusion et CinetPay sans réponse" trailing={<Count n={count('stuck')} />} />
                        <NavRow to="/argent/retraits?vue=historique" icon={<History size={20} />} tone="neutral" title="Historique" description="Retraits payés, refusés, échoués" />
                    </NavList>
                </section>
                {isAdmin && (
                    <>
                        <section>
                            <SectionTitle>Paiements</SectionTitle>
                            <NavList>
                                <NavRow to="/argent/paiements" icon={<CreditCard size={20} />} title="Paiements" description="Abonnements, tickets, campagnes… et leur statut" />
                                <NavRow to="/argent/paiements?vue=mouvements" icon={<ArrowDownUp size={20} />} tone="neutral" title="Mouvements de solde" description="Tout ce qui entre et sort des soldes des membres" />
                                <NavRow to="/argent/resoudre" icon={<LifeBuoy size={20} />} tone="warning" title="Résoudre un problème de paiement" description="Payé sans être activé, retrait bloqué ou non reçu" />
                            </NavList>
                        </section>
                        <section>
                            <SectionTitle>Suivi</SectionTitle>
                            <NavList>
                                <NavRow to="/argent/passerelles" icon={<Landmark size={20} />} tone="neutral" title="Soldes des passerelles" description="Ce que SBC détient chez chaque fournisseur" />
                                <NavRow to="/argent/analyse" icon={<BarChart3 size={20} />} tone="accent" title="Plus gros gains et retraits" description="Classement des membres par montants" />
                            </NavList>
                        </section>
                    </>
                )}
            </div>
        </Page>
    );
}
