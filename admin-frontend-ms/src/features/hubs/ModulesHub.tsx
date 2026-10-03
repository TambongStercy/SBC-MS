import { Gift, Heart, Mail, Megaphone, PartyPopper, ShoppingBag, Ticket, Trophy } from 'lucide-react';
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
                <NavRow to="/modules/billetterie" icon={<Ticket size={20} />} title="Billetterie" description="Événements à valider, organisateurs, commandes, litiges" trailing={<Count n={count('events', 'organizers', 'disputes')} />} />
                <NavRow to="/modules/animation" icon={<PartyPopper size={20} />} tone="accent" title="Animation" description="Défis et votes des événements, activités suspectes, demandes de modification" trailing={<Count n={count('animFraud', 'animChanges')} />} />
                <NavRow to="/modules/relance" icon={<Mail size={20} />} tone="success" title="Relance" description="Relance des nouveaux, campagnes, crédits des parrains, messages" />
                <NavRow to="/modules/sbc-love" icon={<Heart size={20} />} tone="danger" title="SBC Love" description="Profils à valider, signalements, session de la semaine" trailing={<Count n={count('love')} />} />
                <NavRow to="/modules/tombola" icon={<Gift size={20} />} tone="warning" title="Tombola" description="Tombola du mois, billets, tirage et gagnants" />
                <NavRow to="/modules/boutique" icon={<ShoppingBag size={20} />} tone="primary" title="Boutique" description="Produits des membres et ventes flash" />
                <NavRow to="/modules/impact-challenge" icon={<Trophy size={20} />} tone="neutral" title="Impact Challenge" description="Entrepreneurs du mois, votes et versement" />
            </NavList>
        </Page>
    );
}
