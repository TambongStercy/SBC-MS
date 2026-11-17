import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Chatting01Icon, FavouriteIcon, Settings02Icon, UserCheck01Icon } from '@hugeicons/core-free-icons';
import { getStats } from '../services/adminSbcLoveApi';
import { Badge, Button, Metric, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui';
import { TodoAction, TodoPanel, count, formatNumber, formatPercent, useUrlFilters } from '../components/moduleKit';
import { ProfilesTab } from '../components/sbclove/ProfilesTab';
import { MembersTab } from '../components/sbclove/MembersTab';
import { ReportsTab } from '../components/sbclove/ReportsTab';
import { ConfigTab } from '../components/sbclove/ConfigTab';
import { LOVE_FILTER_KEYS } from '../components/sbclove/types';
import { LoveTabFilters, clearTabFilters } from '../components/sbclove/TabFilters';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';

type Tab = 'profiles' | 'reports' | 'members' | 'config';
const TABS: Tab[] = ['profiles', 'reports', 'members', 'config'];

/**
 * SBC Love (module `sbclove`): profiles to validate and reports to handle
 * first, then the member directory and the module settings. The tab and its
 * filters live in the URL.
 */
export default function SbcLoveManagementPage() {
  const f = useUrlFilters(LOVE_FILTER_KEYS);
  const filters = usePageFilters();
  const api = filters.apiParams;
  const tab: Tab = TABS.includes(f.values.tab as Tab) ? (f.values.tab as Tab) : 'profiles';
  const go = (t: Tab, status = '') => f.set({ tab: t === 'profiles' ? '' : t, status, q: '', limit: '' });

  const stats = useQuery({ queryKey: ['sbclove', 'stats'], queryFn: getStats });
  const s = stats.data;
  const v = (n?: number) => (stats.isLoading ? <Skeleton className="h-7 w-16" /> : n == null ? '—' : formatNumber(n));

  return (
    <div className="space-y-6">
      <PageHeader
        title="SBC Love"
        description="Valider les profils, traiter les signalements, suivre les rencontres et régler l’ouverture du module."
        actions={(
          <Button variant="outline" size="lg" className="w-full sm:w-auto" onClick={() => go('config')}>
            <HugeiconsIcon icon={Settings02Icon} size={16} aria-hidden="true" />
            Réglages du module
          </Button>
        )}
      />

      <TodoPanel
        loading={stats.isLoading}
        items={[
          {
            key: 'profiles', label: 'Profils à valider', count: s?.profiles.pending ?? 0,
            hint: 'Nouveaux profils et profils modifiés : photos et description à vérifier.',
            action: <TodoAction onClick={() => go('profiles')}>Examiner</TodoAction>,
          },
          {
            key: 'reports', label: 'Signalements ouverts', count: s?.reports.open ?? 0, tone: 'danger',
            hint: 'Des membres en signalent d’autres.',
            action: <TodoAction onClick={() => go('reports', 'open')}>Traiter</TodoAction>,
          },
        ]}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Profils approuvés" icon={UserCheck01Icon} value={v(s?.profiles.approved)}
          hint={s ? `sur ${count(s.profiles.total, 'profil')} · ${formatNumber(s.profiles.suspended)} suspendus` : undefined} />
        <Metric label="Matchs" icon={FavouriteIcon} value={v(s?.matches.total)}
          hint={s ? `${formatNumber(s.matches.contactUnlocked)} contacts ouverts` : undefined} />
        <Metric label="Conversations" icon={Chatting01Icon} value={v(s?.matches.conversations)}
          hint={s && s.matches.total ? `${formatPercent(s.matches.conversations / s.matches.total, 0)} des matchs` : undefined} />
        <Metric label="Intérêts envoyés" value={v(s?.interests.total)} hint="depuis l’ouverture" />
      </div>

      <Tabs value={tab} onValueChange={t => go(t as Tab, t === 'reports' ? 'open' : '')}>
        <TabsList aria-label="Sections de SBC Love" className="overflow-y-hidden">
          <TabsTrigger value="profiles" className="min-h-11">
            Profils{s && s.profiles.pending > 0 && <Badge tone="warning" className="ml-2">{formatNumber(s.profiles.pending)}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="reports" className="min-h-11">
            Signalements{s && s.reports.open > 0 && <Badge tone="danger" className="ml-2">{formatNumber(s.reports.open)}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="members" className="min-h-11">Membres</TabsTrigger>
          <TabsTrigger value="config" className="min-h-11">Réglages</TabsTrigger>
        </TabsList>
        {tab !== 'config' && (
          <PageFilters filters={filters} onReset={() => clearTabFilters(f)} className="mb-0 mt-4">
            <LoveTabFilters tab={tab} f={f} rowFiltered={filters.isFiltered} />
          </PageFilters>
        )}
        <TabsContent value="profiles" className="pt-4">{tab === 'profiles' && <ProfilesTab f={f} api={api} />}</TabsContent>
        <TabsContent value="reports" className="pt-4">{tab === 'reports' && <ReportsTab f={f} api={api} />}</TabsContent>
        <TabsContent value="members" className="pt-4">{tab === 'members' && <MembersTab f={f} api={api} />}</TabsContent>
        <TabsContent value="config" className="pt-4">{tab === 'config' && <ConfigTab />}</TabsContent>
      </Tabs>
    </div>
  );
}
