import { useIsFetching, useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { IconButton, Page, Tabs } from '../../../ui';
import { useParamState } from '../../../lib/hooks';
import { countOpenFraudFlags, countPendingChangeRequests } from './api-counts';
import { useAnimRefresh } from './shared';
import { OverviewTab } from './OverviewTab';
import { ChallengesTab } from './ChallengesTab';
import { FraudTab } from './FraudTab';
import { ChangeRequestsTab } from './ChangeRequestsTab';
import { TransactionsTab } from './TransactionsTab';
import { AuditTab } from './AuditTab';

/**
 * SBC Event — Animation & Engagement: organisers run challenges with free and
 * paid votes. SBC watches the money, the fraud signals and the locked settings.
 */
export default function AnimationModule() {
    const [tab, setTab] = useParamState('onglet', 'apercu');
    const refresh = useAnimRefresh();
    const fetching = useIsFetching({ queryKey: ['animation'] }) > 0;
    const fraud = useQuery({ queryKey: ['animation', 'count', 'fraud'], queryFn: countOpenFraudFlags });
    const changes = useQuery({ queryKey: ['animation', 'count', 'changes'], queryFn: countPendingChangeRequests });
    return (
        <Page title="Animation" subtitle="Défis et votes des événements" back="/modules" width="wide"
            actions={<IconButton label="Actualiser" onClick={refresh}><RefreshCw size={18} className={fetching ? 'animate-spin' : ''} /></IconButton>}>
            <div className="space-y-4">
                <Tabs value={tab} onChange={setTab} phoneColumns={3} items={[
                    { value: 'apercu', label: 'Aperçu' },
                    { value: 'defis', label: 'Défis' },
                    { value: 'a-verifier', label: 'À vérifier', count: fraud.data },
                    { value: 'demandes', label: 'Demandes', count: changes.data },
                    { value: 'votes', label: 'Votes payants' },
                    { value: 'journal', label: 'Journal' },
                ]} />
                {tab === 'defis' ? <ChallengesTab /> : tab === 'a-verifier' ? <FraudTab /> : tab === 'demandes' ? <ChangeRequestsTab />
                    : tab === 'votes' ? <TransactionsTab /> : tab === 'journal' ? <AuditTab /> : <OverviewTab />}
            </div>
        </Page>
    );
}
