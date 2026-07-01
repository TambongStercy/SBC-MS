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
    { key: 'feexpay', label: 'FeexPay Payments', color: 'text-amber-400' },
    { key: 'moneyfusion', label: 'MoneyFusion Withdrawals', color: 'text-blue-400' },
    { key: 'cinetpay', label: 'CinetPay Withdrawals', color: 'text-purple-400' },
];

const FixProviderIssuesPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<Provider>('feexpay');

    return (
        <div className="flex-1 overflow-auto relative z-10">
            <Header title="Fix Provider Issues" />
            <div className="max-w-7xl mx-auto px-4 lg:px-8 pt-4">
                <div className="border-b border-gray-700 flex gap-1">
                    {TABS.map((tab) => {
                        const isActive = activeTab === tab.key;
                        return (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                                    isActive
                                        ? `border-blue-500 ${tab.color}`
                                        : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
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
