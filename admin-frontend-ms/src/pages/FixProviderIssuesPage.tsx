import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { MoneyReceive01Icon, Wallet01Icon } from '@hugeicons/core-free-icons';
import { getStuckCinetPayWithdrawals, getStuckMoneyFusionWithdrawals } from '../services/adminWithdrawalApi';
import { Badge, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui';
import { cn } from '../lib/cn';
import { formatNumber } from '../components/common/format';
import { useStuckCount } from '../components/payments/stuck';
import { PaymentsFilterRow } from '../components/payments/PaymentsFilterRow';
import { usePageFilters } from '../hooks/usePageFilters';
import FixFeexpayPaymentsPage from './FixFeexpayPaymentsPage';
import FixMoneyFusionWithdrawalsPage from './FixMoneyFusionWithdrawalsPage';
import FixCinetPayWithdrawalsPage from './FixCinetPayWithdrawalsPage';

/**
 * Problèmes fournisseurs: one entry for the three provider repair tools.
 * On top, what is waiting (stuck MoneyFusion and CinetPay withdrawals, counted
 * with the same list endpoints); each card opens its tab. The tab is kept in
 * the URL (`?tab=`), each tool keeps its own search (`q`, `page`).
 */

type Provider = 'moneyfusion' | 'cinetpay' | 'feexpay';
const PROVIDERS: Provider[] = ['moneyfusion', 'cinetpay', 'feexpay'];

function QueueCard({ active, onClick, icon, title, count, loading, error, hint }: {
    active: boolean;
    onClick: () => void;
    icon: IconSvgElement;
    title: string;
    count?: number;
    loading?: boolean;
    error?: boolean;
    hint: string;
}) {
    const waiting = (count ?? 0) > 0;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'flex min-h-[56px] w-full items-center justify-between gap-3 rounded-panel border bg-surface px-4 py-3 text-left transition-colors',
                'sm:flex-col sm:items-stretch sm:justify-start sm:gap-2 sm:p-4',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                active ? 'border-primary' : 'border-line hover:border-line-strong',
            )}
        >
            <span className="flex min-w-0 items-center justify-between gap-3">
                <span className="text-sm font-medium text-fg sm:text-xs sm:text-fg-muted">{title}</span>
                <span className={cn('hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:flex', waiting ? 'bg-warning-soft text-warning' : 'bg-surface-3 text-fg-muted')} aria-hidden="true">
                    <HugeiconsIcon icon={icon} size={16} />
                </span>
            </span>
            <span className="shrink-0 text-xl font-semibold tracking-tight text-fg sm:text-2xl">
                {loading ? <Skeleton className="h-7 w-12 sm:h-8 sm:w-16" /> : error ? <span className="text-sm font-medium text-fg-muted sm:text-base">Indisponible</span> : count === undefined ? <span className="text-sm font-medium text-fg-muted sm:text-base sm:text-fg">Par membre</span> : formatNumber(count)}
            </span>
            <span className="hidden text-xs text-fg-muted sm:block">{hint}</span>
        </button>
    );
}

const FixProviderIssuesPage: React.FC = () => {
    const [params, setParams] = useSearchParams();
    const raw = params.get('tab') as Provider | null;
    const tab: Provider = raw && PROVIDERS.includes(raw) ? raw : 'moneyfusion';

    // Counts follow the country, never the period (see PaymentsFilterRow).
    const filters = usePageFilters();
    const mf = useStuckCount('moneyfusion', getStuckMoneyFusionWithdrawals, filters.country || undefined);
    const cp = useStuckCount('cinetpay', getStuckCinetPayWithdrawals, filters.country || undefined);

    const setTab = (next: string) => {
        if (next === tab) return;
        // Each tool has its own search: switching starts clean, the country / period stay.
        setParams(prev => {
            const p = new URLSearchParams();
            ['pays', 'periode', 'du', 'au'].forEach(k => { const v = prev.get(k); if (v) p.set(k, v); });
            if (next !== 'moneyfusion') p.set('tab', next);
            return p;
        });
    };

    const countBadge = (n?: number) => (n ? <Badge tone="warning" className="ml-1.5 tabular-nums">{formatNumber(n)}</Badge> : null);

    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                className="mb-0"
                title="Problèmes fournisseurs"
                description="Les retraits restés sans réponse chez MoneyFusion ou CinetPay, et les paiements FeexPay d’un membre à revérifier."
            />
            <PaymentsFilterRow filters={filters} />

            <section aria-label="À traiter">
                <h2 className="mb-3 text-sm font-semibold text-fg">À traiter</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
                    <QueueCard
                        active={tab === 'moneyfusion'}
                        onClick={() => setTab('moneyfusion')}
                        icon={Wallet01Icon}
                        title="Retraits MoneyFusion bloqués"
                        count={mf.data}
                        loading={mf.isLoading}
                        error={mf.isError}
                        hint="À vérifier sur le tableau de bord MoneyFusion"
                    />
                    <QueueCard
                        active={tab === 'cinetpay'}
                        onClick={() => setTab('cinetpay')}
                        icon={Wallet01Icon}
                        title="Retraits CinetPay bloqués"
                        count={cp.data}
                        loading={cp.isLoading}
                        error={cp.isError}
                        hint="Un clic demande le statut à CinetPay"
                    />
                    <QueueCard
                        active={tab === 'feexpay'}
                        onClick={() => setTab('feexpay')}
                        icon={MoneyReceive01Icon}
                        title="Paiements FeexPay"
                        hint="Sur demande d’un membre : pas de file d’attente"
                    />
                </div>
            </section>

            <Tabs value={tab} onValueChange={setTab}>
                {/* On phones the cards above switch the tool. */}
                <TabsList aria-label="Fournisseur" className="hidden overflow-y-hidden sm:flex">
                    <TabsTrigger value="moneyfusion" className="min-h-[44px]">Retraits MoneyFusion{countBadge(mf.data)}</TabsTrigger>
                    <TabsTrigger value="cinetpay" className="min-h-[44px]">Retraits CinetPay{countBadge(cp.data)}</TabsTrigger>
                    <TabsTrigger value="feexpay" className="min-h-[44px]">
                        Paiements FeexPay
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="moneyfusion" className="pt-0 sm:pt-5"><FixMoneyFusionWithdrawalsPage embedded /></TabsContent>
                <TabsContent value="cinetpay" className="pt-0 sm:pt-5"><FixCinetPayWithdrawalsPage embedded /></TabsContent>
                <TabsContent value="feexpay" className="pt-0 sm:pt-5"><FixFeexpayPaymentsPage embedded /></TabsContent>
            </Tabs>
        </div>
    );
};

export default FixProviderIssuesPage;
