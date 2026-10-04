import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import {
    getStuckCinetPayWithdrawals, getStuckMoneyFusionWithdrawals, manualCompleteWithdrawal, manualFailWithdrawal, reconcileCinetPayWithdrawal,
    type WithdrawalTransaction,
} from '../../services/adminWithdrawalApi';
import { Button, Card, ConfirmSheet, EmptyState, ErrorState, KeyValue, ListSkeleton, MemberLink, Page, Pagination, SearchInput, Tabs, notify } from '../../ui';
import { formatMoney, formatPhone, timeAgo } from '../../lib/format';
import { operatorLabel } from '../../lib/labels';
import { useDebounced, useParamState } from '../../lib/hooks';
import { WithdrawalSheet, type WithdrawalLike } from './WithdrawalSheet';

const ref = (w: WithdrawalTransaction) => w.metadata?.moneyFusionTokenPay || (w as unknown as { externalTransactionId?: string }).externalTransactionId;
const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => notify.success('Copié.')).catch(() => {});

type Provider = 'moneyfusion' | 'cinetpay';

/**
 * Payouts the provider never answered for. MoneyFusion has no status API:
 * check its dashboard (by reference, or by the gross amount rounded) and mark
 * the result. CinetPay has one: ask it, and only its answer is applied.
 */
export default function StuckPage() {
    const qc = useQueryClient();
    const [provider, setProvider] = useParamState('fournisseur', 'moneyfusion');
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const term = useDebounced(search);
    const [open, setOpen] = useState<WithdrawalLike | null>(null);
    const [action, setAction] = useState<{ kind: 'paid' | 'failed'; w: WithdrawalTransaction } | null>(null);
    const [asking, setAsking] = useState<string | null>(null);

    const counts = useQuery({
        queryKey: ['stuck', 'counts'],
        queryFn: async () => {
            const [mf, cp] = await Promise.all([getStuckMoneyFusionWithdrawals(1, 1), getStuckCinetPayWithdrawals(1, 1)]);
            return { moneyfusion: mf.data.pagination.total, cinetpay: cp.data.pagination.total };
        },
    });
    const list = useQuery({
        queryKey: ['stuck', provider, page, term],
        queryFn: () => (provider === 'cinetpay' ? getStuckCinetPayWithdrawals(page, 20, term) : getStuckMoneyFusionWithdrawals(page, 20, term)).then(r => r.data),
        placeholderData: keepPreviousData,
    });
    const refresh = () => { qc.invalidateQueries({ queryKey: ['stuck'] }); qc.invalidateQueries({ queryKey: ['queue', 'stuck'] }); };

    const askCinetPay = async (w: WithdrawalTransaction) => {
        setAsking(w.transactionId);
        try {
            const r = await reconcileCinetPayWithdrawal(w.transactionId);
            if (r.action === 'completed') notify.success(`CinetPay confirme le paiement : ${formatMoney(w.amount, w.currency)} débités du solde du membre.`);
            else if (r.action === 'failed') notify.success('CinetPay confirme l’échec : retrait marqué échoué, rien n’est débité.');
            else if (r.action === 'still-pending') notify.info(`Toujours en cours chez CinetPay (${r.cinetpayStatus ?? 'en attente'}). Réessaie plus tard.`);
            else notify.info(r.message || 'CinetPay a répondu.');
            refresh();
        } catch (e) {
            notify.error((e as Error).message || 'CinetPay n’a pas répondu.');
        } finally {
            setAsking(null);
        }
    };

    const rows = list.data?.withdrawals;
    return (
        <Page title="Retraits bloqués" back="/argent" subtitle="Envoyés au fournisseur, sans réponse">
            <div className="space-y-3">
                <Tabs<Provider> value={provider as Provider} onChange={v => { setProvider(v); setPage(1); }} items={[
                    { value: 'moneyfusion', label: 'MoneyFusion', count: counts.data?.moneyfusion },
                    { value: 'cinetpay', label: 'CinetPay', count: counts.data?.cinetpay },
                ]} />
                <p className="text-sm text-ink-2">
                    {provider === 'cinetpay'
                        ? 'CinetPay a une API de statut : « Demander à CinetPay » applique sa réponse, rien d’autre.'
                        : 'MoneyFusion n’a pas d’API de statut. Cherche le retrait sur leur tableau de bord (par référence, ou par le montant brut arrondi), puis marque le résultat.'}
                </p>
                <SearchInput value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Nom, téléphone, numéro de retrait…" />
                {list.isLoading ? <ListSkeleton /> : list.isError ? <ErrorState onRetry={() => list.refetch()} /> : !rows?.length ? (
                    <Card><EmptyState title="Aucun retrait bloqué">Rien n’attend chez {provider === 'cinetpay' ? 'CinetPay' : 'MoneyFusion'}.</EmptyState></Card>
                ) : (
                    <ul className="space-y-2">
                        {rows.map(w => {
                            const info = w.metadata?.accountInfo;
                            const r = ref(w);
                            return (
                                <li key={w.transactionId}>
                                    <Card className="space-y-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <MemberLink id={w.userId} name={w.userName} phone={w.userPhoneNumber} />
                                            <button type="button" className="text-sm font-semibold text-primary shrink-0" onClick={() => setOpen(w)}>Détails</button>
                                        </div>
                                        <KeyValue items={[
                                            ['Montant brut', formatMoney(w.amount, w.currency)],
                                            provider === 'moneyfusion' ? ['Chez MoneyFusion', formatMoney(Math.round(w.amount), w.currency)] : null,
                                            ['Vers', info ? `${formatPhone(info.fullMomoNumber)} · ${operatorLabel(info.momoOperator)}` : '—'],
                                            r ? ['Référence', <span className="inline-flex items-center gap-1.5"><span className="font-mono text-xs break-all">{r}</span>
                                                <button type="button" aria-label="Copier la référence" className="text-ink-3 hover:text-ink" onClick={() => copy(r)}><Copy size={14} /></button></span>] : null,
                                            ['Envoyé', timeAgo(w.updatedAt || w.createdAt)],
                                        ]} />
                                        {provider === 'cinetpay' ? (
                                            <Button full loading={asking === w.transactionId} onClick={() => askCinetPay(w)}>Demander à CinetPay</Button>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2">
                                                <Button variant="success" onClick={() => setAction({ kind: 'paid', w })}>Marquer payé</Button>
                                                <Button variant="danger-soft" onClick={() => setAction({ kind: 'failed', w })}>Marquer échoué</Button>
                                            </div>
                                        )}
                                    </Card>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {list.data && <Pagination page={list.data.pagination.page} totalPages={list.data.pagination.totalPages} total={list.data.pagination.total} onChange={setPage} />}
            </div>
            <WithdrawalSheet w={open} onClose={() => setOpen(null)} />
            {action?.kind === 'paid' && (
                <ConfirmSheet open onClose={() => setAction(null)} tone="success" title="Marquer ce retrait payé ?"
                    message={<>
                        <KeyValue items={[['Vers', formatPhone(action.w.metadata?.accountInfo?.fullMomoNumber)], ['Montant', formatMoney(action.w.amount, action.w.currency)]]} />
                        <p>Seulement s’il apparaît « Validé » sur le tableau de bord MoneyFusion. Le solde du membre sera débité.</p>
                    </>}
                    confirmLabel="Oui, il est payé"
                    onConfirm={async () => { await manualCompleteWithdrawal(action.w.transactionId, {}); notify.success('Retrait marqué payé.'); refresh(); }} />
            )}
            {action?.kind === 'failed' && (
                <ConfirmSheet open onClose={() => setAction(null)} tone="danger" title="Marquer ce retrait échoué ?"
                    message={<p>Rien n’est débité : la somme reste sur le solde du membre, qui pourra redemander.</p>}
                    reason={{ label: 'Motif', suggestions: ['Absent du tableau de bord MoneyFusion', 'Annulé chez MoneyFusion', 'Numéro invalide'], minLength: 5 }}
                    confirmLabel="Marquer échoué"
                    onConfirm={async (reason) => { await manualFailWithdrawal(action.w.transactionId, { reason }); notify.success('Retrait marqué échoué.'); refresh(); }} />
            )}
        </Page>
    );
}
