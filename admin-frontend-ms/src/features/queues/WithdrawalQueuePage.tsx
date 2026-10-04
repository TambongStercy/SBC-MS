import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, SkipForward, Sparkles } from 'lucide-react';
import {
    approveWithdrawal, getPendingWithdrawals, rejectWithdrawal, type WithdrawalTransaction,
} from '../../services/adminWithdrawalApi';
import {
    Badge, Button, ButtonLink, Card, ConfirmSheet, EmptyState, ErrorState, KeyValue, ListSkeleton, MemberLink, Page, SectionTitle, StatusBadge, notify,
} from '../../ui';
import { formatDateTime, formatMoney, formatNumber, formatPhone, timeAgo } from '../../lib/format';
import { TX_STATUS, countryName, operatorLabel } from '../../lib/labels';

const REFUSE_REASONS = [
    'Numéro de paiement incorrect',
    'Informations du compte incomplètes',
    'Demande en double',
    'Activité suspecte sur le compte',
];

const DAY = 24 * 60 * 60 * 1000;

function balanceOf(w: WithdrawalTransaction): string {
    const b = w.userBalance;
    if (b === undefined || b === null) return '—';
    if (typeof b === 'number') return formatMoney(b, w.currency);
    const parts = Object.entries(b).filter(([, v]) => typeof v === 'number').map(([c, v]) => formatMoney(v as number, c));
    return parts.join(' · ') || '—';
}

/** What an admin would want to notice before paying. */
function signals(w: WithdrawalTransaction): Array<{ text: string; tone: 'warning' | 'primary' }> {
    const previous = (w.withdrawalHistory ?? []).filter(h => h.transactionId !== w.transactionId);
    const out: Array<{ text: string; tone: 'warning' | 'primary' }> = [];
    if (previous.length === 0) out.push({ text: 'Premier retrait de ce membre', tone: 'primary' });
    const recent = previous.filter(h => new Date(w.createdAt).getTime() - new Date(h.createdAt).getTime() < DAY && h.status !== 'rejected_by_admin');
    if (recent.length > 0) out.push({ text: `${recent.length} autre${recent.length > 1 ? 's' : ''} retrait${recent.length > 1 ? 's' : ''} dans les 24 h`, tone: 'warning' });
    return out;
}

/**
 * Withdrawals waiting for approval, one at a time (≈27 a day), with what's
 * needed to decide on the same screen: amount, destination, balance,
 * referrals and history. Approving sends the money.
 */
export default function WithdrawalQueuePage() {
    const qc = useQueryClient();
    const list = useQuery({
        queryKey: ['withdrawals', 'pending'],
        queryFn: () => getPendingWithdrawals(1, 100).then(r => r.data),
        refetchInterval: 60_000,
    });
    const [decided, setDecided] = useState<Set<string>>(new Set());
    const [skipped, setSkipped] = useState<Set<string>>(new Set());
    const [sheet, setSheet] = useState<'approve' | 'refuse' | null>(null);

    const pending = useMemo(() => (list.data?.withdrawals ?? [])
        .filter(w => !decided.has(w.transactionId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [list.data, decided]);
    const current = pending.find(w => !skipped.has(w.transactionId)) ?? pending[0];
    const total = list.data?.pagination.total ?? 0;
    const remaining = Math.max(total - decided.size, pending.length);

    const done = (id: string) => {
        setDecided(s => new Set(s).add(id));
        setSkipped(s => { const n = new Set(s); n.delete(id); return n; });
        qc.invalidateQueries({ queryKey: ['queue', 'withdrawals'] });
        qc.invalidateQueries({ queryKey: ['today'] });
    };

    const net = current ? current.amount - (current.fee || 0) : 0;
    const info = current?.metadata?.accountInfo;
    const isCrypto = current?.metadata?.withdrawalType === 'crypto';
    const destination = !current ? '' : isCrypto
        ? `${current.metadata?.cryptoCurrency ?? 'Crypto'} · ${current.metadata?.cryptoAddress ?? '—'}`
        : info ? `${formatPhone(info.fullMomoNumber)} · ${operatorLabel(info.momoOperator)}` : '—';

    return (
        <Page title="Retraits à valider" back="/" width="wide" subtitle={list.data ? (remaining ? `${remaining} en attente` : 'Aucun en attente') : undefined}
            actions={<ButtonLink to="/withdrawals/approvals" variant="ghost" size="sm">Liste complète</ButtonLink>}>
            {list.isLoading ? <ListSkeleton rows={3} /> : list.isError ? (
                <ErrorState message="Impossible de charger les retraits." onRetry={() => list.refetch()} />
            ) : !current ? (
                <Card>
                    <EmptyState icon={<CheckCircle2 size={26} className="text-success" />} title="Aucun retrait à valider">
                        Les nouvelles demandes apparaîtront ici.
                    </EmptyState>
                    <div className="flex justify-center pb-4"><ButtonLink to="/" variant="secondary">Retour à l’accueil</ButtonLink></div>
                </Card>
            ) : (
                // On a phone the buttons come right after the amount; on a computer they sit in the right column.
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
                        <Card className="lg:col-start-1">
                            <div className="flex items-start justify-between gap-3">
                                <MemberLink id={current.userId} name={current.userName} phone={current.userPhoneNumber}
                                    sub={current.userEmail && current.userEmail !== 'Unknown' ? current.userEmail : undefined} />
                                <span className="text-xs text-ink-3 tabular shrink-0">{pending.indexOf(current) + 1} / {pending.length}</span>
                            </div>
                            <div className="mt-4">
                                <p className="text-sm text-ink-2">À envoyer</p>
                                <p className="text-4xl font-extrabold tracking-tight tabular">{formatMoney(net, current.currency)}</p>
                                <p className="text-sm text-ink-3 mt-0.5">
                                    Débité : {formatMoney(current.amount, current.currency)} · frais {formatMoney(current.fee || 0, current.currency)}
                                    {isCrypto && current.metadata?.usdAmount ? ` · ${formatMoney(current.metadata.usdAmount, 'USD')}` : ''}
                                </p>
                            </div>
                            {signals(current).length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {signals(current).map(sg => (
                                        <Badge key={sg.text} tone={sg.tone}>{sg.tone === 'warning' ? <AlertTriangle size={12} /> : <Sparkles size={12} />}{sg.text}</Badge>
                                    ))}
                                </div>
                            )}
                            <KeyValue className="mt-3" items={[
                                ['Vers', isCrypto ? (
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="font-mono text-xs break-all">{current.metadata?.cryptoAddress}</span>
                                        <button type="button" aria-label="Copier l’adresse" className="text-ink-3 hover:text-ink"
                                            onClick={() => navigator.clipboard?.writeText(current.metadata?.cryptoAddress ?? '').then(() => notify.success('Adresse copiée.')).catch(() => {})}>
                                            <Copy size={14} />
                                        </button>
                                    </span>
                                ) : info ? formatPhone(info.fullMomoNumber) : '—'],
                                isCrypto ? ['Monnaie', current.metadata?.cryptoCurrency ?? '—'] : ['Opérateur', operatorLabel(info?.momoOperator)],
                                !isCrypto && info?.countryCode ? ['Pays', countryName(info.countryCode)] : null,
                                ['Demandé', `${timeAgo(current.createdAt)} · ${formatDateTime(current.createdAt)}`],
                                ['Solde actuel', balanceOf(current)],
                            ]} />
                        </Card>
                        <Card className="space-y-2 lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:sticky lg:top-20">
                            <Button variant="success" size="lg" full onClick={() => setSheet('approve')}>Valider · {formatMoney(net, current.currency)}</Button>
                            <div className="grid grid-cols-2 gap-2">
                                <Button variant="secondary" onClick={() => setSheet('refuse')}>Refuser…</Button>
                                <Button variant="ghost" icon={<SkipForward size={16} />} disabled={pending.length < 2}
                                    onClick={() => setSkipped(s => new Set(s).add(current.transactionId))}>Passer</Button>
                            </div>
                            <p className="text-xs text-ink-3 pt-1">L’argent part dès la validation. Un refus ne débite rien : le membre est prévenu avec le motif.</p>
                        </Card>

                        {current.referralStats && (
                            <Card className="lg:col-start-1">
                                <SectionTitle>Filleuls</SectionTitle>
                                <KeyValue items={[
                                    ['Directs', `${formatNumber(current.referralStats.directReferrals)} · ${formatNumber(current.referralStats.directSubscribedReferrals)} abonnés`],
                                    ['Indirects', `${formatNumber(current.referralStats.indirectReferrals)} · ${formatNumber(current.referralStats.indirectSubscribedReferrals)} abonnés`],
                                ]} />
                            </Card>
                        )}

                        {(current.withdrawalHistory?.length ?? 0) > 0 && (
                            <Card className="lg:col-start-1">
                                <SectionTitle>Retraits précédents</SectionTitle>
                                <ul className="divide-y divide-border">
                                    {current.withdrawalHistory!.filter(h => h.transactionId !== current.transactionId).slice(0, 6).map(h => (
                                        <li key={h.transactionId} className="flex items-center justify-between gap-3 py-2 text-sm">
                                            <span className="text-ink-2">{formatDateTime(h.createdAt)}</span>
                                            <span className="flex items-center gap-2">
                                                <span className="font-semibold tabular">{formatMoney(h.amount, h.currency || current.currency)}</span>
                                                <StatusBadge status={h.status} labels={TX_STATUS} />
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        )}
                </div>
            )}

            {current && (
                <>
                    <ConfirmSheet open={sheet === 'approve'} onClose={() => setSheet(null)} tone="success"
                        title="Valider ce retrait ?"
                        message={<KeyValue items={[
                            ['Membre', current.userName || '—'],
                            ['Montant envoyé', formatMoney(net, current.currency)],
                            ['Vers', destination],
                        ]} />}
                        confirmLabel="Valider et envoyer"
                        onConfirm={async () => {
                            await approveWithdrawal(current.transactionId, {});
                            notify.success(`Retrait validé : ${formatMoney(net, current.currency)} pour ${current.userName || 'le membre'}.`);
                            done(current.transactionId);
                        }} />
                    <ConfirmSheet open={sheet === 'refuse'} onClose={() => setSheet(null)} tone="danger"
                        title="Refuser ce retrait ?"
                        message={<p>{current.userName || 'Le membre'} est prévenu avec le motif.</p>}
                        reason={{ label: 'Motif du refus', suggestions: REFUSE_REASONS, minLength: 5 }}
                        confirmLabel="Refuser"
                        onConfirm={async (reason) => {
                            await rejectWithdrawal(current.transactionId, { rejectionReason: reason });
                            notify.success('Retrait refusé.');
                            done(current.transactionId);
                        }} />
                </>
            )}
        </Page>
    );
}
