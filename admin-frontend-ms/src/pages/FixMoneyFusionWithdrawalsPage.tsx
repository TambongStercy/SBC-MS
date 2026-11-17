import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, MoreHorizontalIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import {
    WithdrawalTransaction,
    formatCurrency,
    getStuckMoneyFusionWithdrawals,
    manualCompleteWithdrawal,
    manualFailWithdrawal,
} from '../services/adminWithdrawalApi';
import { useToast } from '../hooks/useToast';
import ConfirmationModal from '../components/common/ConfirmationModal';
import { formatMoney } from '../components/common/format';
import { Can } from '../components/Can';
import { usePageFilters } from '../hooks/usePageFilters';
import { PaymentsFilterRow } from '../components/payments/PaymentsFilterRow';
import {
    Button, Dialog, DialogContent, Field, Menu, MenuContent, MenuItem, MenuTrigger, PageHeader, Textarea,
} from '../components/ui';
import { CheckFirst, CopyValue } from '../components/payments/shared';
import { StuckWithdrawalQueue } from '../components/payments/StuckWithdrawalQueue';
import { STUCK_KEY, providerRef } from '../components/payments/stuck';

/**
 * MoneyFusion withdrawals stuck in PROCESSING / PENDING. MF has no payout
 * status API, so the admin confirms on the MF dashboard (by tokenPay, or the
 * gross amount rounded) and marks each one paid (debits the wallet) or
 * failed (wallet untouched, reason required).
 */
interface FixMoneyFusionWithdrawalsPageProps {
    embedded?: boolean;
}

const FixMoneyFusionWithdrawalsPage: React.FC<FixMoneyFusionWithdrawalsPageProps> = ({ embedded = false }) => {
    const { showSuccess, showError } = useToast();
    const queryClient = useQueryClient();
    const filters = usePageFilters();

    const [details, setDetails] = useState<WithdrawalTransaction | null>(null);
    const [actingOn, setActingOn] = useState<string | null>(null);
    const [confirmComplete, setConfirmComplete] = useState<WithdrawalTransaction | null>(null);
    const [failTarget, setFailTarget] = useState<WithdrawalTransaction | null>(null);
    const [failReason, setFailReason] = useState('');

    const refresh = () => queryClient.invalidateQueries({ queryKey: STUCK_KEY });

    const handleMarkCompleted = async (tx: WithdrawalTransaction) => {
        setActingOn(tx.transactionId);
        try {
            await manualCompleteWithdrawal(tx.transactionId, {});
            showSuccess(`Retrait ${tx.transactionId} marqué payé ; ${formatCurrency(tx.amount, tx.currency)} débité du portefeuille du membre.`);
            await refresh();
        } catch (e: unknown) {
            showError((e instanceof Error ? e.message : '') || 'Impossible de marquer le retrait comme payé');
        } finally {
            setActingOn(null);
        }
    };

    const handleMarkFailed = async () => {
        const tx = failTarget;
        if (!tx || actingOn) return;
        const reason = failReason.trim();
        if (!reason) {
            showError("Le motif de l'échec est obligatoire");
            return;
        }
        setActingOn(tx.transactionId);
        try {
            await manualFailWithdrawal(tx.transactionId, { reason });
            showSuccess(`Retrait ${tx.transactionId} marqué en échec.`);
            setFailTarget(null);
            setFailReason('');
            await refresh();
        } catch (e: unknown) {
            showError((e instanceof Error ? e.message : '') || "Impossible de marquer le retrait en échec");
        } finally {
            setActingOn(null);
        }
    };

    // Actions opened from the details sheet close it first (one dialog at a time).
    const askComplete = (tx: WithdrawalTransaction) => { setDetails(null); setConfirmComplete(tx); };
    const askFail = (tx: WithdrawalTransaction) => { setDetails(null); setFailReason(''); setFailTarget(tx); };

    const rowActions = (tx: WithdrawalTransaction, phone: boolean) => {
        const busy = actingOn === tx.transactionId;
        return (
            <Can module="payments" write fallback={phone ? null : <span className="text-xs text-fg-subtle">Lecture seule</span>}>
                <div className={phone ? 'grid grid-cols-2 gap-2' : 'flex items-center justify-end gap-1'} onClick={e => e.stopPropagation()} role="presentation">
                    <Button variant="soft" size={phone ? 'lg' : 'sm'} loading={busy} onClick={() => askComplete(tx)}>
                        {!busy && <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden="true" />}
                        Marquer payé
                    </Button>
                    {phone ? (
                        <Button variant="danger-ghost" size="lg" disabled={busy} onClick={() => askFail(tx)}>
                            <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
                            En échec
                        </Button>
                    ) : (
                        <Menu>
                            <MenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Autres actions pour le retrait ${tx.transactionId}`}>
                                    <HugeiconsIcon icon={MoreHorizontalIcon} size={16} aria-hidden="true" />
                                </Button>
                            </MenuTrigger>
                            <MenuContent>
                                <MenuItem destructive onSelect={() => askFail(tx)}>
                                    <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
                                    Marquer en échec…
                                </MenuItem>
                            </MenuContent>
                        </Menu>
                    )}
                </div>
            </Can>
        );
    };

    const sheetActions = (tx: WithdrawalTransaction) => (
        <Can module="payments" write>
            <Button variant="danger-ghost" size="lg" disabled={actingOn === tx.transactionId} onClick={() => askFail(tx)}>
                <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
                Marquer en échec
            </Button>
            <Button variant="primary" size="lg" loading={actingOn === tx.transactionId} onClick={() => askComplete(tx)}>
                <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden="true" />
                Marquer payé
            </Button>
        </Can>
    );

    return (
        <div className="flex flex-col gap-6">
            {!embedded && (
                <PageHeader
                    className="mb-0"
                    title="Retraits MoneyFusion bloqués"
                    description="Retraits envoyés à MoneyFusion dont la réponse n’est jamais arrivée : vérifiez chacun sur le tableau de bord MoneyFusion, puis marquez-le payé ou en échec."
                />
            )}
            {!embedded && <PaymentsFilterRow filters={filters} />}

            <StuckWithdrawalQueue
                provider="moneyfusion"
                fetcher={getStuckMoneyFusionWithdrawals}
                providerName="MoneyFusion"
                refLabel="tokenPay MoneyFusion"
                actions={{ row: rowActions, sheet: sheetActions }}
                detailsOpen={details}
                onDetailsOpenChange={setDetails}
                emptyDescription="Les retraits validés et envoyés à MoneyFusion apparaissent ici jusqu’à ce que vous les marquiez payés ou en échec."
                checkFirst={(
                    <CheckFirst>
                        <p>
                            MoneyFusion n’a pas d’API de statut : cherchez le retrait sur le tableau de bord MoneyFusion par son <strong className="font-medium text-fg">tokenPay</strong>,
                            ou par le <strong className="font-medium text-fg">montant brut arrondi</strong> (jamais le net demandé).
                        </p>
                        <p>« Validé » chez MoneyFusion → <strong className="font-medium text-fg">Marquer payé</strong> (débite le portefeuille du membre). Absent ou refusé → <strong className="font-medium text-fg">Marquer en échec</strong> (portefeuille inchangé).</p>
                    </CheckFirst>
                )}
            />

            {/* Marking completed debits the member's wallet: only once MoneyFusion shows the payout. */}
            <ConfirmationModal
                isOpen={!!confirmComplete}
                variant="success"
                title="Marquer ce retrait comme payé ?"
                message={confirmComplete && (
                    <div className="space-y-2 text-sm">
                        <dl className="space-y-1">
                            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Membre</dt><dd className="text-right text-fg">{confirmComplete.userName || '—'}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Vers</dt><dd className="text-right font-mono text-fg">{confirmComplete.metadata?.accountInfo?.fullMomoNumber || '—'}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-fg-muted">Montant brut</dt><dd className="text-right font-medium tabular-nums text-fg">{formatMoney(confirmComplete.amount, confirmComplete.currency)}</dd></div>
                            <div className="flex items-center justify-between gap-3"><dt className="shrink-0 text-fg-muted">tokenPay</dt><dd className="min-w-0 text-right"><CopyValue value={providerRef(confirmComplete)} label="Copier le tokenPay" /></dd></div>
                        </dl>
                        <p className="pt-1 text-fg-muted">Vérifiez d’abord qu’il apparaît « Validé » sur le tableau de bord MoneyFusion. Le portefeuille du membre sera débité.</p>
                    </div>
                )}
                confirmText="Oui, il est payé"
                onConfirm={async () => { if (confirmComplete) await handleMarkCompleted(confirmComplete); setConfirmComplete(null); }}
                onCancel={() => setConfirmComplete(null)}
            />

            <Dialog open={!!failTarget} onOpenChange={open => { if (!open && !actingOn) { setFailTarget(null); setFailReason(''); } }}>
                {failTarget && (
                    <DialogContent
                        size="sm"
                        title="Marquer ce retrait en échec ?"
                        description={`${failTarget.userName || 'Membre inconnu'} · ${formatMoney(failTarget.amount, failTarget.currency)} vers ${failTarget.metadata?.accountInfo?.fullMomoNumber || '—'}`}
                        footer={(
                            <>
                                <Button variant="outline" size="lg" disabled={!!actingOn} onClick={() => { setFailTarget(null); setFailReason(''); }}>Annuler</Button>
                                <Button variant="danger" size="lg" loading={actingOn === failTarget.transactionId} disabled={!failReason.trim()} onClick={() => void handleMarkFailed()}>
                                    Confirmer l’échec
                                </Button>
                            </>
                        )}
                    >
                        <div className="space-y-3">
                            <p className="text-sm text-fg-muted">Le retrait passe en échec ; le portefeuille du membre n’est pas touché (il n’a jamais été débité).</p>
                            <Field label="Motif" required help="Gardé dans l’historique du retrait.">
                                <Textarea
                                    value={failReason}
                                    onChange={e => setFailReason(e.target.value)}
                                    placeholder="Ex. : absent du tableau de bord MoneyFusion"
                                    autoFocus
                                />
                            </Field>
                        </div>
                    </DialogContent>
                )}
            </Dialog>
        </div>
    );
};

export default FixMoneyFusionWithdrawalsPage;
