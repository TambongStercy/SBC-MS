import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Hourglass, PhoneMissed, Receipt } from 'lucide-react';
import { listAdminTransactions, reprocessFeexpayPaymentsForUser, type PaymentIntent } from '../../services/adminPaymentApi';
import { getUserWithdrawalHistory } from '../../services/adminWithdrawalApi';
import { MemberPicker } from '../members/MemberPicker';
import type { Member } from '../members/api';
import { Button, ButtonLink, Card, EmptyState, ListSkeleton, NavList, NavRow, Page, SectionTitle, StatusBadge, notify } from '../../ui';
import { formatDateTime, formatMoney } from '../../lib/format';
import { PAYMENT_STATUS, TX_STATUS, gatewayLabel, paymentTypeLabel } from '../../lib/labels';
import { useParamState } from '../../lib/hooks';
import { WithdrawalSheet, type WithdrawalLike } from './WithdrawalSheet';

/** What to do about one payment attempt, in plain words. */
function advice(p: PaymentIntent): { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
    const g = (p.gateway || '').toLowerCase();
    if (p.status === 'SUCCEEDED') return { text: 'Le paiement a réussi. Si l’abonnement n’est pas actif, récupère-le ci-dessous.', tone: 'success' };
    if (p.status === 'FAILED' || p.status === 'CANCELED') return { text: 'Le fournisseur indique un échec. Si le membre a la preuve du débit (SMS de l’opérateur), vérifie sur le tableau de bord du fournisseur avant de récupérer.', tone: 'danger' };
    if (g === 'feexpay') return { text: 'En attente chez FeexPay : « Revérifier chez FeexPay » applique sa réponse tout de suite (le serveur le fait aussi toutes les 10 minutes).', tone: 'warning' };
    if (g === 'nowpayments') return { text: 'Paiement crypto en attente : NOWPayments confirme quand la transaction est validée sur la blockchain.', tone: 'warning' };
    return { text: `En attente chez ${gatewayLabel(p.gateway)}. Le serveur lui redemande toutes les 10 minutes pendant 7 jours ; rien à faire tant que le membre n’a pas de preuve du débit.`, tone: 'warning' };
}

function PaidNotReceived() {
    const [member, setMember] = useState<Member | null>(null);
    const [busy, setBusy] = useState(false);
    const payments = useQuery({
        queryKey: ['resolve', 'payments', member?._id],
        queryFn: () => listAdminTransactions({ userSearchTerm: member!._id, page: 1, limit: 10 }),
        enabled: !!member,
    });
    const hasFeexpayPending = payments.data?.data.some(p => (p.gateway || '').toLowerCase() === 'feexpay' && p.status !== 'SUCCEEDED' && p.status !== 'FAILED');
    const recheck = async () => {
        if (!member) return;
        setBusy(true);
        try {
            const results = await reprocessFeexpayPaymentsForUser(member._id);
            const ok = results.filter(r => r.status === 'SUCCEEDED').length;
            notify.success(ok ? `${ok} paiement${ok > 1 ? 's' : ''} confirmé${ok > 1 ? 's' : ''} par FeexPay.` : 'FeexPay ne confirme aucun paiement en attente.');
            payments.refetch();
        } catch (e) {
            notify.error((e as Error).message || 'FeexPay n’a pas répondu.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="space-y-4">
            <SectionTitle>1. Le membre</SectionTitle>
            <MemberPicker value={member} onChange={setMember} autoFocus />
            {member && (
                <>
                    <SectionTitle>2. Ses derniers paiements</SectionTitle>
                    {payments.isLoading ? <ListSkeleton rows={3} /> : !payments.data?.data.length ? (
                        <Card><EmptyState title="Aucun paiement enregistré">Le paiement n’a jamais atteint SBC. Demande au membre la référence de l’opérateur et cherche-la ci-dessous.</EmptyState></Card>
                    ) : (
                        <ul className="space-y-2">
                            {payments.data.data.map(p => {
                                const a = advice(p);
                                return (
                                    <li key={p._id || p.sessionId}>
                                        <Card className="space-y-2">
                                            <div className="flex items-start justify-between gap-3">
                                                <div><p className="font-semibold">{paymentTypeLabel(p.paymentType)} · {formatMoney(p.amount ?? p.paidAmount, p.currency ?? p.paidCurrency)}</p>
                                                    <p className="text-sm text-ink-2">{gatewayLabel(p.gateway)} · {formatDateTime(p.createdAt)}</p></div>
                                                <StatusBadge status={p.status} labels={PAYMENT_STATUS} />
                                            </div>
                                            <p className={`text-sm rounded-tile px-3 py-2 ${a.tone === 'success' ? 'bg-success-soft text-success' : a.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>{a.text}</p>
                                        </Card>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    <SectionTitle>3. Agir</SectionTitle>
                    <div className="flex flex-col sm:flex-row gap-2">
                        {hasFeexpayPending && <Button loading={busy} onClick={recheck}>Revérifier chez FeexPay</Button>}
                        <ButtonLink to={`/argent/resoudre/abonnement?membre=${member._id}`} variant="secondary">Récupérer un abonnement payé<ArrowRight size={16} /></ButtonLink>
                    </div>
                </>
            )}
        </div>
    );
}

function WithdrawalNotReceived() {
    const [member, setMember] = useState<Member | null>(null);
    const [open, setOpen] = useState<WithdrawalLike | null>(null);
    const list = useQuery({
        queryKey: ['resolve', 'withdrawals', member?._id],
        queryFn: () => getUserWithdrawalHistory(member!._id, 1, 10).then(r => r.data),
        enabled: !!member,
    });
    return (
        <div className="space-y-4">
            <SectionTitle>1. Le membre</SectionTitle>
            <MemberPicker value={member} onChange={setMember} autoFocus />
            {member && (
                <>
                    <SectionTitle>2. Le retrait</SectionTitle>
                    {list.isLoading ? <ListSkeleton rows={3} /> : !list.data?.withdrawals.length ? (
                        <Card><EmptyState title="Aucun retrait pour ce membre" /></Card>
                    ) : (
                        <NavList>
                            {list.data.withdrawals.map(w => (
                                <NavRow key={w.transactionId} onClick={() => setOpen(w)} icon={<Receipt size={18} />} tone="neutral"
                                    title={formatMoney(w.amount, w.currency)} description={`${w.serviceProvider || w.metadata?.selectedPayoutService || 'Pas encore envoyé'} · ${formatDateTime(w.createdAt)}`}
                                    trailing={<StatusBadge status={w.status} labels={TX_STATUS} />} />
                            ))}
                        </NavList>
                    )}
                    <Card className="text-sm text-ink-2 space-y-1">
                        <p className="font-semibold text-ink">Comment vérifier</p>
                        <p>Ouvre le retrait et cherche-le sur le tableau de bord du fournisseur par sa référence, ou par le montant brut arrondi (MoneyFusion affiche notre montant brut, pas celui demandé par le membre).</p>
                        <p>Présent et validé : l’argent est parti, c’est à voir avec l’opérateur. Absent : préviens la technique pour rembourser le membre.</p>
                    </Card>
                </>
            )}
            <WithdrawalSheet w={open} onClose={() => setOpen(null)} />
        </div>
    );
}

/**
 * Start from the problem, not the tool: say what happened and the page shows
 * what the server knows and the right action.
 */
export default function ResolvePage() {
    const [problem, setProblem] = useParamState('probleme', '');
    return (
        <Page title="Problème de paiement" back={problem ? '/argent/resoudre' : undefined} width="narrow">
            {!problem ? (
                <NavList>
                    <NavRow onClick={() => setProblem('paye')} icon={<Receipt size={20} />} tone="primary" title="Un membre a payé mais n’a rien reçu"
                        description="Abonnement, ticket, campagne… payé mais pas activé" />
                    <NavRow to="/argent/bloques" icon={<Hourglass size={20} />} tone="danger" title="Un retrait est bloqué"
                        description="Envoyé à MoneyFusion ou CinetPay, sans réponse" />
                    <NavRow onClick={() => setProblem('retrait')} icon={<PhoneMissed size={20} />} tone="warning" title="Le membre n’a pas reçu son retrait"
                        description="Marqué payé chez nous, mais rien sur son téléphone" />
                </NavList>
            ) : (
                <div className="space-y-4">
                    <button type="button" onClick={() => setProblem('')} className="text-sm font-semibold text-primary">← Choisir un autre problème</button>
                    {problem === 'paye' ? <PaidNotReceived /> : <WithdrawalNotReceived />}
                </div>
            )}
        </Page>
    );
}
