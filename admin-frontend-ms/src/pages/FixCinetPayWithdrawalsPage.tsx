import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon } from '@hugeicons/core-free-icons';
import {
    WithdrawalTransaction,
    formatCurrency,
    getStuckCinetPayWithdrawals,
    reconcileCinetPayWithdrawal,
} from '../services/adminWithdrawalApi';
import { useToast } from '../hooks/useToast';
import { Can } from '../components/Can';
import { usePageFilters } from '../hooks/usePageFilters';
import { PaymentsFilterRow } from '../components/payments/PaymentsFilterRow';
import { Button, PageHeader } from '../components/ui';
import { CheckFirst } from '../components/payments/shared';
import { StuckWithdrawalQueue } from '../components/payments/StuckWithdrawalQueue';
import { STUCK_KEY } from '../components/payments/stuck';

/**
 * CinetPay withdrawals stuck in PROCESSING / PENDING. CinetPay rarely calls
 * our webhook, but its status API is authoritative, so one button per row
 * asks it and applies the answer:
 *   - completed → wallet debited, status COMPLETED
 *   - failed    → status FAILED, no wallet movement
 *   - pending   → nothing changed, try later
 */
interface FixCinetPayWithdrawalsPageProps {
    embedded?: boolean;
}

const FixCinetPayWithdrawalsPage: React.FC<FixCinetPayWithdrawalsPageProps> = ({ embedded = false }) => {
    const { showSuccess, showError, showInfo } = useToast();
    const queryClient = useQueryClient();
    const filters = usePageFilters();
    const [details, setDetails] = useState<WithdrawalTransaction | null>(null);
    const [actingOn, setActingOn] = useState<string | null>(null);

    const handleVerifyAndApply = async (tx: WithdrawalTransaction) => {
        // One check at a time: a second tap while CinetPay answers does nothing.
        if (actingOn) return;
        setActingOn(tx.transactionId);
        try {
            const res = await reconcileCinetPayWithdrawal(tx.transactionId);
            if (res.action === 'completed') {
                showSuccess(`CinetPay confirme le paiement : ${formatCurrency(tx.amount, tx.currency)} débité du portefeuille du membre.`);
            } else if (res.action === 'failed') {
                showSuccess(`CinetPay confirme l'échec : retrait marqué en échec, portefeuille inchangé.`);
            } else if (res.action === 'still-pending') {
                showInfo(`Toujours « ${res.cinetpayStatus} » chez CinetPay. Rien n'a changé, réessayez plus tard.`);
            } else {
                showInfo(res.message || `Action : ${res.action}`);
            }
            setDetails(null);
            await queryClient.invalidateQueries({ queryKey: STUCK_KEY });
        } catch (e: unknown) {
            showError((e instanceof Error ? e.message : '') || 'La vérification a échoué');
        } finally {
            setActingOn(null);
        }
    };

    const verifyButton = (tx: WithdrawalTransaction, size: 'sm' | 'lg', variant: 'soft' | 'primary') => (
        <Button
            variant={variant}
            size={size}
            className={size === 'lg' ? 'w-full sm:w-auto' : undefined}
            loading={actingOn === tx.transactionId}
            disabled={!!actingOn && actingOn !== tx.transactionId}
            onClick={e => { e.stopPropagation(); void handleVerifyAndApply(tx); }}
        >
            {actingOn !== tx.transactionId && <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />}
            {actingOn === tx.transactionId ? 'Vérification…' : 'Vérifier et appliquer'}
        </Button>
    );

    return (
        <div className="flex flex-col gap-6">
            {!embedded && (
                <PageHeader
                    className="mb-0"
                    title="Retraits CinetPay bloqués"
                    description="Retraits envoyés à CinetPay restés sans réponse : un clic demande leur statut à CinetPay et applique sa réponse."
                />
            )}
            {!embedded && <PaymentsFilterRow filters={filters} />}

            <StuckWithdrawalQueue
                provider="cinetpay"
                fetcher={getStuckCinetPayWithdrawals}
                providerName="CinetPay"
                refLabel="Référence CinetPay"
                detailsOpen={details}
                onDetailsOpenChange={setDetails}
                emptyDescription="Les retraits validés et envoyés à CinetPay apparaissent ici si CinetPay n’a jamais répondu."
                actions={{
                    row: (tx, phone) => (
                        <Can module="payments" write fallback={phone ? null : <span className="text-xs text-fg-subtle">Lecture seule</span>}>
                            {verifyButton(tx, phone ? 'lg' : 'sm', 'soft')}
                        </Can>
                    ),
                    sheet: tx => <Can module="payments" write>{verifyButton(tx, 'lg', 'primary')}</Can>,
                }}
                checkFirst={(
                    <CheckFirst title="Rien à vérifier à la main">
                        <p>
                            « Vérifier et appliquer » interroge l’API de statut de CinetPay, qui fait foi : payé → retrait terminé et portefeuille débité ;
                            échoué → retrait en échec, portefeuille inchangé ; encore en attente → rien ne change, réessayez plus tard.
                        </p>
                    </CheckFirst>
                )}
            />
        </div>
    );
};

export default FixCinetPayWithdrawalsPage;
