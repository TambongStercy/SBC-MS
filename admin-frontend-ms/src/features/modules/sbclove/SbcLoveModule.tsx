import { useQuery } from '@tanstack/react-query';
import { getStats } from '../../../services/adminSbcLoveApi';
import { Page, Tabs } from '../../../ui';
import { useParamState } from '../../../lib/hooks';
import { ReviewTab } from './ReviewTab';
import { ProfilesTab } from './ProfilesTab';
import { ReportsTab } from './ReportsTab';
import { SettingsTab } from './SettingsTab';

/** SBC Love: validate profiles, handle reports, set the weekly session. */
export default function SbcLoveModule() {
    const [tab, setTab] = useParamState('onglet', 'a-valider');
    const stats = useQuery({ queryKey: ['sbclove', 'stats'], queryFn: getStats });
    return (
        <Page title="SBC Love" width="wide">
            <div className="space-y-4">
                <Tabs value={tab} onChange={setTab} phoneColumns={2} items={[
                    { value: 'a-valider', label: 'À valider', count: stats.data?.profiles.pending },
                    { value: 'profils', label: 'Profils' },
                    { value: 'signalements', label: 'Signalements', count: stats.data?.reports.open },
                    { value: 'reglages', label: 'Réglages' },
                ]} />
                {tab === 'profils' ? <ProfilesTab /> : tab === 'signalements' ? <ReportsTab /> : tab === 'reglages' ? <SettingsTab /> : <ReviewTab />}
            </div>
        </Page>
    );
}
