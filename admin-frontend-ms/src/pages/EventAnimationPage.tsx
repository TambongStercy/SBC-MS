import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/common/Header';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
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
    const { toasts, removeToast, showSuccess, showError } = useToast();
    const [version, setVersion] = useState(0);
    const [counts, setCounts] = useState<{ fraud?: number; changes?: number }>({});
    const tab = (TABS.some(t => t.id === searchParams.get('tab')) ? searchParams.get('tab') : 'apercu') as TabId;

    const refresh = useCallback(() => setVersion(v => v + 1), []);
    const setParams = useCallback((next: Record<string, string>) => {
        setSearchParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)));
    }, [setSearchParams]);

    useEffect(() => {
        let alive = true;
        Promise.allSettled([countOpenFraudFlags(), countPendingChangeRequests()]).then(([f, c]) => {
            if (alive) setCounts({ fraud: f.status === 'fulfilled' ? f.value : undefined, changes: c.status === 'fulfilled' ? c.value : undefined });
        });
        return () => { alive = false; };
    }, [version]);

    const ctx = useMemo<AnimPageContext>(() => ({
        version, refresh, notifySuccess: showSuccess, notifyError: showError,
        param: (key: string) => searchParams.get(key) ?? '', setParams,
    }), [version, refresh, showSuccess, showError, searchParams, setParams]);

    const badge = (id: TabId) => (id === 'a-verifier' ? counts.fraud : id === 'demandes' ? counts.changes : undefined);

    return (
        <AnimContext.Provider value={ctx}>
            <div className="flex-1 overflow-y-auto">
                <Header title="SBC Event — Animation et engagement" />
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-fg-muted">Défis et votes des événements : activité, fraude, demandes de modification, votes payants et journal.</p>
                        <button onClick={refresh} className="border border-line-strong rounded-lg px-3 py-2 text-sm bg-surface text-fg hover:bg-surface-2">Actualiser</button>
                    </div>

                    <div className="border-b border-line overflow-x-auto">
                        <nav className="flex gap-1">
                            {TABS.map(t => {
                                const n = badge(t.id);
                                return (
                                    <button key={t.id} onClick={() => setParams({ tab: t.id })}
                                        className={`px-4 py-2.5 text-sm font-medium rounded-t-lg whitespace-nowrap transition-colors ${tab === t.id
                                            ? 'bg-surface text-purple-600 dark:text-purple-300 border-b-2 border-purple-500'
                                            : 'text-fg-muted hover:text-fg hover:bg-surface'}`}>
                                        {t.label}
                                        {!!n && <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs bg-amber-500 text-gray-900 font-semibold">{n}</span>}
                                    </button>
                                );
                            })}
                        </nav>
                    </div>

                    {tab === 'defis' ? <ChallengesTab />
                        : tab === 'a-verifier' ? <FraudTab />
                        : tab === 'demandes' ? <ChangeRequestsTab />
                        : tab === 'votes' ? <TransactionsTab />
                        : tab === 'journal' ? <AuditTab />
                        : tab === 'exports' ? <ExportsTab />
                        : <OverviewTab />}
                </div>
            </div>
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </AnimContext.Provider>
    );
}
