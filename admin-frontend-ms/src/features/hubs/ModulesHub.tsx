import { Gift, Heart, Mail, Megaphone, ShoppingBag, Ticket, Trophy } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useQueueCounts } from '../home/queues';
import { NavList, NavRow, Page } from '../../ui';

const Count = ({ n }: { n?: number }) =>
    n ? <span className="rounded-pill bg-primary px-2 py-0.5 text-xs font-bold text-white tabular">{n}</span> : null;

/** Each product SBC runs, one entry each, with what is waiting inside. */
export default function ModulesHub() {
    const { role } = useAuth();
    const { defs, results } = useQueueCounts(role);
    const count = (...keys: string[]) => keys.reduce((s, k) => s + (results[defs.findIndex(d => d.key === k)]?.data?.count ?? 0), 0);

    return (
        <Page title="Modules">
            <NavList>
                <NavRow to="/modules/ads" icon={<Megaphone size={20} />} tone="accent" title="Ads Network" description="Campagnes, diffuseurs, vérifications" trailing={<Count n={count('campaigns', 'proofs')} />} />
                <NavRow to="/event" icon={<Ticket size={20} />} title="Billetterie" description="Organisateurs, événements, commandes, litiges" trailing={<Count n={count('organizers', 'disputes')} />} />
                <NavRow to="/relance/dashboard" icon={<Mail size={20} />} tone="success" title="Relance" description="Relance des nouveaux et campagnes" />
                <NavRow to="/sbclove" icon={<Heart size={20} />} tone="danger" title="SBC Love" description="Profils, signalements, réglages" trailing={<Count n={count('love')} />} />
                <NavRow to="/tombola" icon={<Gift size={20} />} tone="warning" title="Tombola" description="Tirages du mois et gagnants" />
                <NavRow to="/products" icon={<ShoppingBag size={20} />} tone="primary" title="Boutique" description="Produits et ventes flash" />
                <NavRow to="/impact-challenges" icon={<Trophy size={20} />} tone="neutral" title="Impact Challenge" description="Votes et collectes du mois" />
            </NavList>
        </Page>
    );
}
