import React, { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Cancel01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import ConfirmationModal from '../common/ConfirmationModal';
import { RelativeTime } from '../common/DataStates';
import { formatDateTime, formatNumber } from '../common/format';
import { Can } from '../Can';
import { Button, Dialog, DialogClose, DialogContent, Field, SheetContent, Textarea } from '../ui';
import { DetailList, Reference, SheetSection, errorMessage, exactMoney } from '../finance/shared';
import { getCountryName } from '../../utils/countryUtils';
import {
    WithdrawalTransaction,
    approveWithdrawal,
    rejectWithdrawal
} from '../../services/adminWithdrawalApi';
import { withdrawalTypeLabel } from './withdrawalStatus';
import { WithdrawalStatusBadge } from './WithdrawalStatusBadge';

interface WithdrawalDetailsModalProps {
    withdrawal: WithdrawalTransaction | null;
    isOpen: boolean;
    onClose: () => void;
    onApproved?: () => void;
    onRejected?: () => void;
    showSuccess?: (message: string) => void;
    showError?: (message: string) => void;
}

/**
 * One withdrawal in a side sheet (full screen on phones): amount, where the
 * money goes, the member's balance and history, and, while it waits for an
 * admin, the decision (validate behind a confirmation, reject with a reason).
 * Name and props kept from the former modal.
 */
const WithdrawalDetailsModal: React.FC<WithdrawalDetailsModalProps> = ({
    withdrawal,
    isOpen,
    onClose,
    onApproved,
    onRejected,
    showSuccess,
    showError
}) => {
    const [isApproving, setIsApproving] = useState(false);
    const [confirmApprove, setConfirmApprove] = useState(false);
    const [isRejecting, setIsRejecting] = useState(false);
    const [showRejectForm, setShowRejectForm] = useState(false);
    const [rejectionReason, setRejectionReason] = useState('');
    const [adminNotes, setAdminNotes] = useState('');
    const [error, setError] = useState<string | null>(null);

    // A different withdrawal opens with an empty decision form.
    const currentId = withdrawal?.transactionId;
    useEffect(() => {
        setConfirmApprove(false);
        setShowRejectForm(false);
        setRejectionReason('');
        setAdminNotes('');
        setError(null);
    }, [currentId]);

    const busy = isApproving || isRejecting;

    const handleApprove = async () => {
        if (!withdrawal) return;

        setError(null);
        setIsApproving(true);

        try {
            await approveWithdrawal(withdrawal.transactionId, {
                adminNotes: adminNotes || undefined
            });

            if (showSuccess) {
                showSuccess('Retrait validé');
            }
            if (onApproved) onApproved();
            onClose();
        } catch (err: unknown) {
            const errorMsg = errorMessage(err, 'Impossible de valider le retrait');
            setError(errorMsg);
            if (showError) {
                showError(errorMsg);
            }
        } finally {
            setIsApproving(false);
        }
    };

    const handleReject = async () => {
        if (!withdrawal || !rejectionReason.trim()) {
            const errorMsg = 'Le motif du rejet est obligatoire';
            setError(errorMsg);
            if (showError) {
                showError(errorMsg);
            }
            return;
        }

        setError(null);
        setIsRejecting(true);

        try {
            await rejectWithdrawal(withdrawal.transactionId, {
                rejectionReason,
                adminNotes: adminNotes || undefined
            });

            if (showSuccess) {
                showSuccess('Retrait rejeté');
            }
            setShowRejectForm(false);
            if (onRejected) onRejected();
            onClose();
        } catch (err: unknown) {
            const errorMsg = errorMessage(err, 'Impossible de rejeter le retrait');
            setError(errorMsg);
            if (showError) {
                showError(errorMsg);
            }
        } finally {
            setIsRejecting(false);
        }
    };

    const w = withdrawal;
    const isPendingApproval = w?.status === 'pending_admin_approval';
    const isRejected = w?.status === 'rejected_by_admin';
    const isMobileMoneyWithdrawal = w?.metadata?.withdrawalType === 'mobile_money';
    const account = w?.metadata?.accountInfo;
    const net = w ? w.amount - w.fee : 0;

    const balance = (() => {
        if (!w || w.userBalance === undefined || w.userBalance === null) return null;
        if (typeof w.userBalance === 'number') return [[w.currency as string, w.userBalance] as const];
        const entries = Object.entries(w.userBalance);
        return entries.length > 0 ? entries : null;
    })();

    const footer = w && isPendingApproval ? (
        <Can module="withdrawals" write fallback={<p className="text-sm text-fg-muted">Lecture seule : vous ne pouvez pas décider de ce retrait.</p>}>
            <Button variant="danger-ghost" size="lg" onClick={() => setShowRejectForm(true)} disabled={busy}>
                <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden="true" />
                Rejeter
            </Button>
            <Button
                variant="primary"
                size="lg"
                className="bg-success text-white hover:bg-success/90 dark:text-background"
                onClick={() => setConfirmApprove(true)}
                loading={isApproving}
                disabled={busy}
            >
                {!isApproving && <HugeiconsIcon icon={Tick02Icon} size={18} aria-hidden="true" />}
                {isApproving ? 'Validation…' : 'Valider le retrait'}
            </Button>
        </Can>
    ) : undefined;

    return (
        <Dialog open={isOpen && !!w} onOpenChange={open => { if (!open && !busy) onClose(); }}>
            {w && (
                <SheetContent
                    width="lg"
                    title="Détail du retrait"
                    description={`${w.userName || w.userEmail || 'Membre'} · ${withdrawalTypeLabel(w.metadata?.withdrawalType)}`}
                    footer={footer}
                >
                    <div className="space-y-6">
                        {error && (
                            <div role="alert" className="flex items-start gap-2 rounded-control border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm text-danger">
                                <HugeiconsIcon icon={Alert02Icon} size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                                <p>{error}</p>
                            </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <WithdrawalStatusBadge status={w.status} />
                            <span className="text-sm text-fg-muted">Demandé <RelativeTime value={w.createdAt} /></span>
                        </div>

                        {/* The amount that leaves, first */}
                        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-control border border-line bg-line">
                            <div className="bg-surface p-3">
                                <p className="text-xs text-fg-muted">Montant envoyé</p>
                                <p className="mt-1 text-lg font-semibold text-fg">{exactMoney(net, w.currency)}</p>
                            </div>
                            <div className="bg-surface p-3">
                                <p className="text-xs text-fg-muted">Frais</p>
                                <p className="mt-1 text-lg font-semibold text-fg-muted">{exactMoney(w.fee, w.currency)}</p>
                            </div>
                            <div className="bg-surface p-3">
                                <p className="text-xs text-fg-muted">Total débité</p>
                                <p className="mt-1 text-lg font-semibold text-fg">{exactMoney(w.amount, w.currency)}</p>
                            </div>
                        </div>

                        {isMobileMoneyWithdrawal && account && (
                            <SheetSection title="Envoyé vers (Mobile Money)">
                                <DetailList items={[
                                    { label: 'Numéro', value: <Reference value={account.fullMomoNumber} /> },
                                    { label: 'Opérateur', value: account.momoOperator },
                                    { label: 'Pays', value: account.countryCode ? `${getCountryName(account.countryCode)} (${account.countryCode})` : '—' },
                                    { label: 'Nom du bénéficiaire', value: account.recipientName, hidden: !account.recipientName },
                                ]} />
                            </SheetSection>
                        )}

                        {!isMobileMoneyWithdrawal && w.metadata?.cryptoAddress && (
                            <SheetSection title="Envoyé vers (crypto)">
                                <DetailList items={[
                                    { label: 'Adresse du portefeuille', value: <Reference value={w.metadata.cryptoAddress} /> },
                                    { label: 'Devise', value: w.metadata.cryptoCurrency },
                                    { label: 'Montant en USD', value: w.metadata.usdAmount ? exactMoney(w.metadata.usdAmount, 'USD') : '—', hidden: !w.metadata.usdAmount },
                                ]} />
                            </SheetSection>
                        )}

                        <SheetSection title="Membre">
                            <DetailList items={[
                                { label: 'Nom', value: w.userName || '—' },
                                { label: 'E-mail', value: w.userEmail || '—' },
                                { label: 'Téléphone', value: w.userPhoneNumber || '—' },
                                { label: 'ID membre', value: <Reference value={w.userId} /> },
                                {
                                    label: 'Solde actuel',
                                    value: balance
                                        ? <span className="flex flex-col items-start gap-0.5 tabular-nums sm:items-end">{balance.map(([cur, amt]) => <span key={cur}>{exactMoney(amt as number, cur)}</span>)}</span>
                                        : <span className="text-fg-muted">Solde non disponible</span>,
                                },
                            ]} />
                        </SheetSection>

                        {w.referralStats && (
                            <SheetSection title="Filleuls">
                                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-control border border-line bg-line text-sm">
                                    {[
                                        { label: 'Directs', total: w.referralStats.directReferrals, active: w.referralStats.directSubscribedReferrals },
                                        { label: 'Indirects', total: w.referralStats.indirectReferrals, active: w.referralStats.indirectSubscribedReferrals },
                                        { label: 'Abonnés (total)', total: w.referralStats.totalSubscribedReferrals, active: null, of: w.referralStats.totalReferrals },
                                    ].map(r => (
                                        <div key={r.label} className="bg-surface p-3">
                                            <p className="text-xs text-fg-muted">{r.label}</p>
                                            <p className="mt-1 text-lg font-semibold text-fg">{formatNumber(r.total)}</p>
                                            <p className="text-xs text-fg-muted">
                                                {r.active !== null ? `${formatNumber(r.active)} abonné${r.active > 1 ? 's' : ''}` : `sur ${formatNumber(r.of)}`}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </SheetSection>
                        )}

                        {w.withdrawalHistory && w.withdrawalHistory.length > 0 && (
                            <SheetSection title="Retraits récents du membre">
                                <ul className="divide-y divide-line rounded-control border border-line">
                                    {w.withdrawalHistory.map((item, index) => (
                                        <li key={`${item.transactionId}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium tabular-nums text-fg">{exactMoney(item.amount, item.currency || w.currency)}</p>
                                                <p className="truncate font-mono text-xs text-fg-subtle" title={item.transactionId}>{item.transactionId}</p>
                                            </div>
                                            <div className="flex shrink-0 flex-col items-end gap-1">
                                                <WithdrawalStatusBadge status={item.status} />
                                                <RelativeTime value={item.createdAt} className="text-xs text-fg-muted" />
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </SheetSection>
                        )}

                        {isRejected && w.rejectionReason && (
                            <SheetSection title="Rejet">
                                <DetailList items={[
                                    { label: 'Motif', value: w.rejectionReason },
                                    { label: 'Notes de l’admin', value: w.adminNotes, hidden: !w.adminNotes },
                                    { label: 'Rejeté le', value: formatDateTime(w.rejectedAt), hidden: !w.rejectedAt },
                                ]} />
                            </SheetSection>
                        )}

                        <SheetSection title="Références">
                            <DetailList items={[
                                { label: 'ID transaction', value: <Reference value={w.transactionId} /> },
                                { label: 'Fournisseur', value: w.serviceProvider, hidden: !w.serviceProvider },
                                { label: 'Demandé le', value: formatDateTime(w.createdAt) },
                                { label: 'Validé le', value: formatDateTime(w.approvedAt), hidden: !w.approvedAt },
                            ]} />
                        </SheetSection>

                        {isPendingApproval && (
                            <Can module="withdrawals" write>
                                <Field label="Notes (facultatif)" help="Gardées avec le retrait, pour l’équipe.">
                                    <Textarea
                                        value={adminNotes}
                                        onChange={(e) => setAdminNotes(e.target.value)}
                                        rows={3}
                                        placeholder="Ajoutez une note sur ce retrait…"
                                    />
                                </Field>
                            </Can>
                        )}
                    </div>

                    {/* Nested here so a click in them is not an "outside" click for the sheet. */}
                    {/* Approving sends real money: say how much, to whom, before it goes. */}
                    <ConfirmationModal
                        isOpen={confirmApprove}
                        variant="success"
                        title="Valider ce retrait ?"
                        message={
                            <div className="space-y-1 text-sm">
                                <p><span className="text-fg-muted">Membre :</span> <span className="text-fg">{w.userName || w.userEmail || w.userId}</span></p>
                                <p><span className="text-fg-muted">Montant envoyé :</span> <span className="font-medium text-fg">{exactMoney(net, w.currency)}</span></p>
                                {account?.fullMomoNumber && (
                                    <p><span className="text-fg-muted">Vers :</span> <span className="text-fg">{account.fullMomoNumber} ({account.momoOperator})</span></p>
                                )}
                                <p className="pt-2">L’argent part dès la validation.</p>
                            </div>
                        }
                        confirmText="Valider le retrait"
                        onConfirm={async () => { await handleApprove(); setConfirmApprove(false); }}
                        onCancel={() => setConfirmApprove(false)}
                    />

                    <Dialog open={showRejectForm} onOpenChange={open => { if (!open && !isRejecting) { setShowRejectForm(false); setRejectionReason(''); } }}>
                        {showRejectForm && (
                            <DialogContent
                                size="sm"
                                title="Rejeter ce retrait ?"
                                description={`${exactMoney(net, w.currency)} pour ${w.userName || w.userEmail || 'ce membre'}. Le membre verra le motif.`}
                                footer={(
                                    <>
                                        <DialogClose asChild>
                                            <Button variant="outline" size="lg" disabled={isRejecting}>Annuler</Button>
                                        </DialogClose>
                                        <Button variant="danger" size="lg" onClick={handleReject} loading={isRejecting} disabled={isRejecting || !rejectionReason.trim()}>
                                            {isRejecting ? 'Rejet…' : 'Confirmer le rejet'}
                                        </Button>
                                    </>
                                )}
                            >
                                <div className="space-y-4">
                                    <Field label="Motif du rejet" required>
                                        <Textarea
                                            value={rejectionReason}
                                            onChange={(e) => setRejectionReason(e.target.value)}
                                            rows={3}
                                            placeholder="Pourquoi rejetez-vous ce retrait ?"
                                            autoFocus
                                        />
                                    </Field>
                                    <Field label="Notes complémentaires (facultatif)">
                                        <Textarea
                                            value={adminNotes}
                                            onChange={(e) => setAdminNotes(e.target.value)}
                                            rows={2}
                                            placeholder="Autres remarques…"
                                        />
                                    </Field>
                                </div>
                            </DialogContent>
                        )}
                    </Dialog>
                </SheetContent>
            )}
        </Dialog>
    );
};

export default WithdrawalDetailsModal;
