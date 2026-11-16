import React, { useState } from 'react';
import Header from '../components/common/Header';
import FixFeexpayPaymentsPage from './FixFeexpayPaymentsPage';
import FixMoneyFusionWithdrawalsPage from './FixMoneyFusionWithdrawalsPage';
import FixCinetPayWithdrawalsPage from './FixCinetPayWithdrawalsPage';

/**
 * Unified triage page for provider-side issues. Consolidates what were three
 * separate sidebar entries (Fix FeexPay Payments, Fix MoneyFusion Withdrawals,
 * Fix CinetPay Withdrawals) into a single page with tabs, so admin doesn't
 * have to hunt for the right tool.
 *
 * Each tab renders the existing dedicated page component with `embedded=true`,
 * suppressing its inner <Header /> so this page's single header is the title.
 */

type Provider = 'feexpay' | 'moneyfusion' | 'cinetpay';

const TABS: Array<{ key: Provider; label: string; color: string }> = [
    { key: 'feexpay', label: 'Paiements FeexPay', color: 'text-amber-700 dark:text-amber-400' },
    { key: 'moneyfusion', label: 'Retraits MoneyFusion', color: 'text-blue-600 dark:text-blue-400' },
    { key: 'cinetpay', label: 'Retraits CinetPay', color: 'text-purple-600 dark:text-purple-400' },
];

const FixProviderIssuesPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<Provider>('feexpay');

    return (
        <div>
            <Header title="Incidents fournisseurs" />
            <div className="mb-6">
                <div className="border-b border-line flex gap-1 overflow-x-auto">
                    {TABS.map((tab) => {
                        const isActive = activeTab === tab.key;
                        return (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`whitespace-nowrap px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                                    isActive
                                        ? `border-blue-500 ${tab.color}`
                                        : 'border-transparent text-fg-muted hover:text-fg hover:border-line-strong'
                                }`}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {activeTab === 'feexpay' && <FixFeexpayPaymentsPage embedded />}
            {activeTab === 'moneyfusion' && <FixMoneyFusionWithdrawalsPage embedded />}
            {activeTab === 'cinetpay' && <FixCinetPayWithdrawalsPage embedded />}
        </div>
    );
};

export default FixProviderIssuesPage;
