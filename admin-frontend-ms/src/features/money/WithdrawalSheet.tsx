import { Copy } from 'lucide-react';
import { ButtonLink, KeyValue, MemberLink, Sheet, StatusBadge, notify } from '../../ui';
import { formatDateTime, formatMoney, formatPhone } from '../../lib/format';
import { TX_STATUS, countryName, operatorLabel } from '../../lib/labels';

/** The fields any withdrawal record (queue item or ledger row) can carry. */
export type WithdrawalLike = {
    transactionId: string;
    userId?: string;
    userName?: string;
    userPhoneNumber?: string;
    amount: number;
    fee?: number;
    currency?: string;
    status: string;
    serviceProvider?: string;
    externalTransactionId?: string;
    rejectionReason?: string;
    adminNotes?: string;
    createdAt: string;
    updatedAt?: string;
    metadata?: Record<string, any>;
};

const copy = (text: string, what: string) =>
    navigator.clipboard?.writeText(text).then(() => notify.success(`${what} copié.`)).catch(() => notify.error('Copie impossible : sélectionne le texte.'));

/**
 * One withdrawal in full. For a "I didn't receive it" complaint: search the
 * provider's dashboard by the provider reference, or by the gross amount
 * rounded — MoneyFusion shows our gross, not what the member asked for.
 */
export function WithdrawalSheet({ w, onClose }: { w: WithdrawalLike | null; onClose: () => void }) {
    if (!w) return null;
    const m = w.metadata ?? {};
    const info = m.accountInfo;
    const crypto = m.withdrawalType === 'crypto';
    const provider = w.serviceProvider || m.selectedPayoutService;
    const ref = w.externalTransactionId || m.moneyFusionTokenPay;
    const net = m.netAmountRequested ?? (w.amount - (w.fee ?? 0));
    const cur = w.currency || 'XAF';

    return (
        <Sheet open onClose={onClose} title="Retrait" size="lg">
            <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <MemberLink id={w.userId} name={w.userName} phone={w.userPhoneNumber} />
                    <StatusBadge status={w.status} labels={TX_STATUS} />
                </div>
                <div>
                    <p className="text-sm text-ink-2">Envoyé au membre</p>
                    <p className="text-3xl font-extrabold tabular">{formatMoney(net, cur)}</p>
                    <p className="text-sm text-ink-3">Débité : {formatMoney(w.amount, cur)} · frais {formatMoney(w.fee ?? 0, cur)}</p>
                </div>
                <KeyValue items={[
                    ['Vers', crypto ? <span className="font-mono text-xs break-all">{m.cryptoAddress ?? '—'}</span> : info ? formatPhone(info.fullMomoNumber) : '—'],
                    !crypto && info ? ['Opérateur', `${operatorLabel(info.momoOperator)} · ${countryName(info.countryCode)}`] : null,
                    crypto ? ['Monnaie', m.cryptoCurrency ?? '—'] : null,
                    ['Fournisseur', provider || 'Pas encore envoyé'],
                    ref ? ['Référence fournisseur', (
                        <span className="inline-flex items-center gap-1.5">
                            <span className="font-mono text-xs break-all">{ref}</span>
                            <button type="button" aria-label="Copier la référence" className="text-ink-3 hover:text-ink" onClick={() => copy(ref, 'Référence')}><Copy size={14} /></button>
                        </span>
                    )] : null,
                    provider === 'MoneyFusion' ? ['Montant chez MoneyFusion', formatMoney(Math.round(w.amount), cur)] : null,
                    ['Demandé', formatDateTime(w.createdAt)],
                    m.payoutCompletedAt ? ['Payé', formatDateTime(m.payoutCompletedAt)] : null,
                    m.manualCompletion ? ['Marqué payé à la main', `${formatDateTime(m.manualCompletion.at)}${m.manualCompletion.reason ? ` · ${m.manualCompletion.reason}` : ''}`] : null,
                    w.rejectionReason ? ['Motif du refus', w.rejectionReason] : null,
                    w.adminNotes ? ['Note admin', w.adminNotes] : null,
                    ['ID', <span className="font-mono text-xs">{w.transactionId}</span>],
                ]} />
                {w.status === 'pending_admin_approval' && (
                    <ButtonLink to="/a-traiter/retraits" full>Ouvrir la file des retraits</ButtonLink>
                )}
            </div>
        </Sheet>
    );
}
