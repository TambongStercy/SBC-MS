import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { getGatewayBalances, getLiveGatewayBalances, updateGatewayBalances } from '../../services/adminSettingsApi';
import { Badge, Button, Card, ConfirmSheet, IconButton, Input, KeyValue, Page, SectionTitle, Skeleton, Textarea, notify } from '../../ui';
import { formatDateTime, formatMoney } from '../../lib/format';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * How much SBC holds at each payment provider. Live where the provider has a
 * balance API; otherwise the figure an admin last entered by hand.
 */
export default function GatewaysPage() {
    const qc = useQueryClient();
    const manual = useQuery({ queryKey: ['gateways', 'manual'], queryFn: getGatewayBalances });
    const live = useQuery({ queryKey: ['gateways', 'live'], queryFn: getLiveGatewayBalances, staleTime: 60_000 });
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({ feexpay: '', cinetpay: '', nowpayments: '', notes: '' });
    const [confirm, setConfirm] = useState(false);

    const startEdit = () => {
        const m = manual.data;
        setForm({ feexpay: String(m?.feexpayBalanceXAF ?? ''), cinetpay: String(m?.cinetpayBalanceXAF ?? ''), nowpayments: String(m?.nowpaymentsBalanceUSD ?? ''), notes: m?.notes ?? '' });
        setEditing(true);
    };
    const l = live.data;

    return (
        <Page title="Soldes des passerelles" back="/argent" width="narrow"
            actions={<IconButton label="Actualiser" onClick={() => { live.refetch(); manual.refetch(); }}><RefreshCw size={20} /></IconButton>}>
            <div className="space-y-5">
                <section>
                    <SectionTitle>En direct</SectionTitle>
                    {live.isLoading ? <Skeleton className="h-40 rounded-card" /> : live.isError ? (
                        <Card className="text-sm text-ink-2">Les fournisseurs n’ont pas répondu. Réessaie dans un instant.</Card>
                    ) : l && (
                        <Card>
                            <KeyValue items={[
                                ['NOWPayments (crypto)', l.nowpayments.available
                                    ? <span>{formatMoney(num(l.nowpayments.totalUsd), 'USD')}{num(l.nowpayments.totalPendingUsd) > 0 && <span className="block text-xs text-ink-3">+ {formatMoney(num(l.nowpayments.totalPendingUsd), 'USD')} en attente</span>}</span>
                                    : <Badge tone="danger">Indisponible</Badge>],
                                ['CinetPay', l.cinetpay.available
                                    ? <span>{formatMoney(num(l.cinetpay.available_balance), l.cinetpay.currency)}<span className="block text-xs text-ink-3">un seul pays : le premier configuré</span></span>
                                    : <Badge tone="danger">Indisponible</Badge>],
                                ['FeexPay', <span className="text-ink-3 font-normal">Pas d’API de solde</span>],
                                ['MoneyFusion', <span className="text-ink-3 font-normal">Pas d’API de solde</span>],
                            ]} />
                            <p className="mt-2 text-xs text-ink-3">Relevé {formatDateTime(l.timestamp)}. CinetPay tient un solde par pays ; ce chiffre n’en montre qu’un.</p>
                        </Card>
                    )}
                </section>
                <section>
                    <SectionTitle action={!editing && <Button size="sm" variant="secondary" onClick={startEdit}>Modifier</Button>}>Saisis à la main</SectionTitle>
                    {manual.isLoading ? <Skeleton className="h-36 rounded-card" /> : !editing ? (
                        <Card>
                            <KeyValue items={[
                                ['FeexPay', formatMoney(num(manual.data?.feexpayBalanceXAF))],
                                ['CinetPay', formatMoney(num(manual.data?.cinetpayBalanceXAF))],
                                ['NOWPayments', formatMoney(num(manual.data?.nowpaymentsBalanceUSD), 'USD')],
                            ]} />
                            {manual.data?.lastUpdatedAt && <p className="mt-2 text-xs text-ink-3">Mis à jour {formatDateTime(manual.data.lastUpdatedAt)}{manual.data.notes ? ` · ${manual.data.notes}` : ''}</p>}
                        </Card>
                    ) : (
                        <Card className="space-y-3">
                            <Input label="FeexPay (FCFA)" inputMode="decimal" value={form.feexpay} onChange={e => setForm(f => ({ ...f, feexpay: e.target.value }))} />
                            <Input label="CinetPay (FCFA)" inputMode="decimal" value={form.cinetpay} onChange={e => setForm(f => ({ ...f, cinetpay: e.target.value }))} />
                            <Input label="NOWPayments ($)" inputMode="decimal" value={form.nowpayments} onChange={e => setForm(f => ({ ...f, nowpayments: e.target.value }))} />
                            <Textarea label="Note" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="D’où viennent ces chiffres" />
                            <div className="flex justify-end gap-2">
                                <Button variant="secondary" onClick={() => setEditing(false)}>Annuler</Button>
                                <Button onClick={() => setConfirm(true)}>Enregistrer</Button>
                            </div>
                        </Card>
                    )}
                </section>
            </div>
            <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} title="Enregistrer ces soldes ?"
                message={<p>Ces chiffres servent au calcul des revenus. Ils ne changent rien chez les fournisseurs.</p>}
                confirmLabel="Enregistrer"
                onConfirm={async () => {
                    await updateGatewayBalances({ feexpayBalanceXAF: num(form.feexpay), cinetpayBalanceXAF: num(form.cinetpay), nowpaymentsBalanceUSD: num(form.nowpayments), notes: form.notes });
                    notify.success('Soldes enregistrés.');
                    setEditing(false);
                    qc.invalidateQueries({ queryKey: ['gateways'] });
                }} />
        </Page>
    );
}
