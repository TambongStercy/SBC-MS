import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { RefreshIcon } from '@hugeicons/core-free-icons';
import { useToast } from '../hooks/useToast';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { Button, PageHeader, Tabs, TabsList, TabsTrigger } from '../components/ui';
import { TodoAction, TodoPanel } from '../components/moduleKit';
import { AnimContext, countOpenFraudFlags, countPendingChangeRequests, type AnimPageContext } from '../components/eventAnimation/shared';
import OverviewTab from '../components/eventAnimation/OverviewTab';
import ChallengesTab from '../components/eventAnimation/ChallengesTab';
import FraudTab from '../components/eventAnimation/FraudTab';
import ChangeRequestsTab from '../components/eventAnimation/ChangeRequestsTab';
import TransactionsTab from '../components/eventAnimation/TransactionsTab';
import AuditTab from '../components/eventAnimation/AuditTab';
import ExportsTab from '../components/eventAnimation/ExportsTab';

type TabId = 'apercu' | 'defis' | 'a-verifier' | 'demandes' | 'votes' | 'journal' | 'exports';
const TABS: { id: TabId; label: string }[] = [
    { id: 'apercu', label: 'Aperçu' },
    { id: 'defis', label: 'Défis' },
    { id: 'a-verifier', label: 'À vérifier' },
    { id: 'demandes', label: 'Demandes' },
    { id: 'votes', label: 'Votes payants' },
    { id: 'journal', label: 'Journal' },
    { id: 'exports', label: 'Exports' },
];

/**
 * SBC Event — Animation & Engagement: organisers run challenges with free and
 * paid votes. SBC watches the money, the fraud signals and the locked settings.
 *
 * The tab lives in the URL (`/event/animation?tab=a-verifier`), with `defi`
 * (a challenge) and `statut` (a challenge status) as filters, so the SBC Event
 * dashboard and the challenge detail can link straight to a filtered view.
 */
export default function EventAnimationPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const { showSuccess, showError } = useToast();
    const [version, setVersion] = useState(0);
    const [counts, setCounts] = useState<{ fraud?: number; changes?: number } | null>(null);
    const tab = (TABS.some(t => t.id === searchParams.get('tab')) ? searchParams.get('tab') : 'apercu') as TabId;

    const filters = usePageFilters();
    const queueParams = useMemo(() => (filters.country ? { country: filters.country } : {}), [filters.country]);
    const scopeKey = JSON.stringify(filters.apiParams);

    const refresh = useCallback(() => setVersion(v => v + 1), []);
    /** Replaces the tab's own params (tab, defi, statut) and keeps the country/period filter. */
    const setParams = useCallback((next: Record<string, string>) => {
        setSearchParams(prev => {
            const out = new URLSearchParams(Object.entries(next).filter(([, v]) => v));
            for (const k of ['pays', 'periode', 'du', 'au']) { const v = prev.get(k); if (v) out.set(k, v); }
            return out;
        });
    }, [setSearchParams]);

    useEffect(() => {
        let alive = true;
        Promise.allSettled([countOpenFraudFlags(queueParams), countPendingChangeRequests(queueParams)]).then(([f, c]) => {
            if (alive) setCounts({ fraud: f.status === 'fulfilled' ? f.value : undefined, changes: c.status === 'fulfilled' ? c.value : undefined });
        });
        return () => { alive = false; };
    }, [version, queueParams]);

    const ctx = useMemo<AnimPageContext>(() => ({
        version, refresh, notifySuccess: showSuccess, notifyError: showError,
        param: (key: string) => searchParams.get(key) ?? '', setParams,
        apiParams: filters.apiParams, queueParams, scopeKey,
    }), [version, refresh, showSuccess, showError, searchParams, setParams, filters.apiParams, queueParams, scopeKey]);

    const badge = (id: TabId) => (id === 'a-verifier' ? counts?.fraud : id === 'demandes' ? counts?.changes : undefined);

    return (
        <AnimContext.Provider value={ctx}>
            <div className="space-y-6">
                <PageHeader
                    title="Animation et engagement"
                    description="Les défis et votes des événements : activité, fraude, demandes de modification, votes payants et journal."
                    actions={(
                        <Button size="lg" className="w-full sm:w-auto" onClick={refresh}>
                            <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />Actualiser
                        </Button>
                    )}
                />

                <PageFilters filters={filters} />

                {tab !== 'a-verifier' && tab !== 'demandes' && (
                    <TodoPanel
                        loading={counts === null}
                        items={[
                            {
                                key: 'fraud', label: 'Activités suspectes à vérifier', count: counts?.fraud ?? 0, tone: 'danger',
                                hint: 'Un signalement à score élevé empêche de figer le résultat du défi.',
                                action: <TodoAction onClick={() => setParams({ tab: 'a-verifier' })}>Vérifier</TodoAction>,
                            },
                            {
                                key: 'changes', label: 'Demandes de modification', count: counts?.changes ?? 0,
                                hint: 'Réglages verrouillés qu’un organisateur demande à changer.',
                                action: <TodoAction onClick={() => setParams({ tab: 'demandes' })}>Examiner</TodoAction>,
                            },
                        ]}
                    />
                )}

                <Tabs value={tab} onValueChange={v => setParams({ tab: v })}>
                    <TabsList aria-label="Sections de l’animation">
                        {TABS.map(t => {
                            const n = badge(t.id);
                            return (
                                <TabsTrigger key={t.id} value={t.id} className="min-h-11 sm:min-h-0">
                                    {t.label}
                                    {!!n && <span className="ml-1.5 rounded-md bg-warning-soft px-1.5 py-0.5 text-xs font-semibold tabular-nums text-fg">{n}</span>}
                                </TabsTrigger>
                            );
                        })}
                    </TabsList>
                </Tabs>

                {tab === 'defis' ? <ChallengesTab />
                    : tab === 'a-verifier' ? <FraudTab />
                    : tab === 'demandes' ? <ChangeRequestsTab />
                    : tab === 'votes' ? <TransactionsTab />
                    : tab === 'journal' ? <AuditTab />
                    : tab === 'exports' ? <ExportsTab />
                    : <OverviewTab />}
            </div>
        </AnimContext.Provider>
    );
}
