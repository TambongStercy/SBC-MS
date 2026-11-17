import React, { useCallback, useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Edit02Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import {
    getGatewayBalances, updateGatewayBalances, getLiveGatewayBalances,
    type IGatewayBalances, type IGatewayBalanceInput, type ILiveGatewayBalances,
} from '../../services/adminSettingsApi';
import { Can } from '../Can';
import { Badge, Button, Dialog, DialogClose, DialogContent, Field, Input, Panel, PanelBody, PanelHeader, Segmented, Skeleton, Tooltip } from '../ui';
import { cn } from '../../lib/cn';
import { formatDateTime, formatMoney } from './format';

/** The provider's raw (English) error, said in French; the raw text stays in the tooltip. */
function providerErrorFr(provider: string, raw: string): string {
    if (/NOWPAYMENTS_EMAIL|NOWPAYMENTS_PASSWORD|API_KEY|not configured|requires/i.test(raw)) return `Solde en direct indisponible : ${provider} n'est pas configuré sur ce serveur.`;
    if (/authenticat|unauthori|401|403/i.test(raw)) return `Solde en direct indisponible : ${provider} a refusé la connexion.`;
    if (/timeout|ECONN|ENOTFOUND|network/i.test(raw)) return `Solde en direct indisponible : ${provider} ne répond pas.`;
    return `Solde en direct indisponible chez ${provider}.`;
}

interface GatewayBalancesCardProps {
    totalUserBalanceXAF?: number;
    totalUserBalanceUSD?: number;
    onUpdate?: () => void;
    /**
     * Set when the member balances above are one country's only (page country
     * filter): the gateways' balances are global, so no margin is computed.
     */
    liabilitiesScope?: string;
}

const USD_TO_XAF_RATE = 600;

/**
 * Money that arrived over the wire, as a number you can safely format.
 * A provider returning "12.34" instead of 12.34 used to throw from render and
 * unmount the whole dashboard.
 */
const money = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

function Provider({ name, value, badge, children }: { name: string; value: string; badge?: React.ReactNode; children?: React.ReactNode }) {
    return (
        <div className="rounded-control border border-line p-4">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-fg-muted">{name}</p>
                {badge}
            </div>
            <p className="mt-2 text-xl font-semibold tracking-tight text-fg">{value}</p>
            {children && <div className="mt-1 space-y-0.5 text-xs text-fg-muted">{children}</div>}
        </div>
    );
}

/** One currency's line: held by the gateways, owed to members, margin. */
function MarginRow({ label, held, owed, currency, scoped }: { label: string; held: number; owed: number; currency: 'XAF' | 'USD'; scoped: boolean }) {
    const margin = held - owed;
    return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-[8rem_1fr_1fr_1fr] sm:items-baseline">
            <p className="col-span-2 font-medium text-fg sm:col-span-1">{label}</p>
            <p className="text-fg-muted">Détenu <span className="block font-medium text-fg tabular-nums sm:inline sm:ml-1">{formatMoney(held, currency)}</span></p>
            <p className="text-fg-muted">Dû aux membres <span className="block font-medium text-fg tabular-nums sm:inline sm:ml-1">{formatMoney(owed, currency)}</span></p>
            {!scoped && (
                <p className="col-span-2 text-fg-muted sm:col-span-1">
                    Marge{' '}
                    <span className={cn('font-semibold tabular-nums', margin >= 0 ? 'text-success' : 'text-danger')}>
                        {margin > 0 ? '+' : ''}{formatMoney(margin, currency)}
                    </span>
                </p>
            )}
        </div>
    );
}

/**
 * What the payment gateways hold (live from their APIs where they have one,
 * else the figures typed here), against what SBC owes members.
 * Editing the manual figures needs `payments` write.
 */
const GatewayBalancesCard: React.FC<GatewayBalancesCardProps> = ({
    totalUserBalanceXAF = 0,
    totalUserBalanceUSD = 0,
    onUpdate,
    liabilitiesScope,
}) => {
    const [balances, setBalances] = useState<IGatewayBalances | null>(null);
    const [liveBalances, setLiveBalances] = useState<ILiveGatewayBalances | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingLive, setIsLoadingLive] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<'live' | 'manual'>('live');
    const showLiveBalances = mode === 'live';

    const [editForm, setEditForm] = useState<IGatewayBalanceInput>({
        nowpaymentsBalanceUSD: 0,
        feexpayBalanceXAF: 0,
        cinetpayBalanceXAF: 0,
        notes: '',
    });

    const resetForm = (data: IGatewayBalances | null) => {
        if (!data) return;
        setEditForm({
            nowpaymentsBalanceUSD: data.nowpaymentsBalanceUSD,
            feexpayBalanceXAF: data.feexpayBalanceXAF,
            cinetpayBalanceXAF: data.cinetpayBalanceXAF,
            notes: data.notes || '',
        });
    };

    const fetchBalances = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await getGatewayBalances();
            setBalances(data);
            resetForm(data);
        } catch (err) {
            console.error('Error fetching gateway balances:', err);
            setError('Les soldes enregistrés n’ont pas pu être chargés.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const fetchLiveBalances = useCallback(async () => {
        setIsLoadingLive(true);
        try {
            setLiveBalances(await getLiveGatewayBalances());
        } catch (err) {
            // Live figures are a bonus: the manual ones are still shown.
            console.error('Error fetching live gateway balances:', err);
        } finally {
            setIsLoadingLive(false);
        }
    }, []);

    useEffect(() => {
        void fetchBalances();
        void fetchLiveBalances();
    }, [fetchBalances, fetchLiveBalances]);

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const updated = await updateGatewayBalances(editForm);
            setBalances(updated);
            setIsEditing(false);
            onUpdate?.();
        } catch (err) {
            console.error('Error updating gateway balances:', err);
            setError('La mise à jour n’a pas pu être enregistrée.');
        } finally {
            setIsSaving(false);
        }
    };

    const nowLive = showLiveBalances && !!liveBalances?.nowpayments.available;
    const cinetLive = showLiveBalances && !!liveBalances?.cinetpay.available;

    const totalExternalUSD = nowLive ? money(liveBalances!.nowpayments.totalUsd) : money(balances?.nowpaymentsBalanceUSD);
    const cinetpayXAF = cinetLive ? money(liveBalances!.cinetpay.available_balance) : money(balances?.cinetpayBalanceXAF);
    const feexpayXAF = money(balances?.feexpayBalanceXAF); // always manual
    const totalExternalXAF = cinetpayXAF + feexpayXAF;
    const totalExternalCombinedXAF = totalExternalXAF + totalExternalUSD * USD_TO_XAF_RATE;
    const combinedMargin = (totalExternalXAF - totalUserBalanceXAF) + (totalExternalUSD - totalUserBalanceUSD) * USD_TO_XAF_RATE;
    const scoped = !!liabilitiesScope;

    const liveBadge = <Badge tone="success">En direct</Badge>;
    const manualBadge = <Badge tone="neutral">Saisi à la main</Badge>;

    return (
        <Panel>
            <PanelHeader
                title="Argent chez les passerelles"
                description="Ce que détiennent NOWPayments, FeexPay et CinetPay, comparé à ce que SBC doit aux membres."
                className="flex-col sm:flex-row"
                actions={(
                    <div className="flex flex-wrap items-center gap-2">
                        <Segmented
                            label="Source des soldes"
                            size="sm"
                            value={mode}
                            onValueChange={setMode}
                            options={[{ value: 'live', label: 'En direct' }, { value: 'manual', label: 'Saisis' }]}
                        />
                        <Tooltip content="Actualiser">
                            <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" aria-label="Actualiser les soldes"
                                onClick={() => { void fetchBalances(); void fetchLiveBalances(); }} disabled={isLoadingLive}>
                                <HugeiconsIcon icon={RefreshIcon} size={16} className={isLoadingLive ? 'animate-spin' : undefined} aria-hidden="true" />
                            </Button>
                        </Tooltip>
                        <Can module="payments" write>
                            <Button size="sm" className="h-11 sm:h-8" onClick={() => { resetForm(balances); setIsEditing(true); }} disabled={!balances}>
                                <HugeiconsIcon icon={Edit02Icon} size={14} aria-hidden="true" />
                                Modifier les soldes saisis
                            </Button>
                        </Can>
                    </div>
                )}
            />
            <PanelBody className="space-y-4">
                {error && (
                    <p role="alert" className="flex items-center gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
                        <HugeiconsIcon icon={Alert02Icon} size={16} aria-hidden="true" />
                        {error}
                    </p>
                )}

                {isLoading ? (
                    <div className="grid gap-3 md:grid-cols-3">
                        {[0, 1, 2].map(i => <Skeleton key={i} className="h-24" />)}
                    </div>
                ) : (
                    <div className="grid gap-3 md:grid-cols-3">
                        <Provider
                            name="NOWPayments (crypto)"
                            value={formatMoney(totalExternalUSD, 'USD')}
                            badge={nowLive ? liveBadge : manualBadge}
                        >
                            {nowLive && money(liveBalances!.nowpayments.totalPendingUsd) > 0 && (
                                <p>+ {formatMoney(money(liveBalances!.nowpayments.totalPendingUsd), 'USD')} en attente</p>
                            )}
                            {showLiveBalances && liveBalances?.nowpayments.error && <p className="text-danger" title={liveBalances.nowpayments.error}>{providerErrorFr('NOWPayments', liveBalances.nowpayments.error)}</p>}
                            {nowLive && liveBalances!.nowpayments.balances.filter(b => b.amount > 0).length > 0 && (
                                <details className="pt-1">
                                    <summary className="cursor-pointer text-fg-muted hover:text-fg">Détail par crypto</summary>
                                    <ul className="mt-1 space-y-0.5">
                                        {liveBalances!.nowpayments.balances.filter(b => b.amount > 0).map(b => (
                                            <li key={b.currency} className="flex justify-between gap-2 tabular-nums">
                                                <span className="uppercase">{b.currency}</span>
                                                <span>{money(b.amount).toFixed(6)} (≈ {formatMoney(money(b.usdValue), 'USD')})</span>
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </Provider>
                        <Provider name="FeexPay" value={formatMoney(feexpayXAF)} badge={manualBadge}>
                            <p>Pas d’API de solde : chiffre saisi ici.</p>
                        </Provider>
                        <Provider name="CinetPay" value={formatMoney(cinetpayXAF)} badge={cinetLive ? liveBadge : manualBadge}>
                            {cinetLive && (
                                <>
                                    <p>Total {formatMoney(money(liveBalances!.cinetpay.total))}{liveBalances!.cinetpay.inUse > 0 ? ` · en cours ${formatMoney(money(liveBalances!.cinetpay.inUse))}` : ''}</p>
                                    <p className="text-fg-subtle">Solde d’un seul pays CinetPay (limite connue de l’API).</p>
                                </>
                            )}
                            {showLiveBalances && liveBalances?.cinetpay.error && <p className="text-danger" title={liveBalances.cinetpay.error}>{providerErrorFr('CinetPay', liveBalances.cinetpay.error)}</p>}
                        </Provider>
                    </div>
                )}

                <div className="divide-y divide-line border-t border-line">
                    <MarginRow label="Francs (XAF)" held={totalExternalXAF} owed={totalUserBalanceXAF} currency="XAF" scoped={scoped} />
                    <MarginRow label="Dollars (USD)" held={totalExternalUSD} owed={totalUserBalanceUSD} currency="USD" scoped={scoped} />
                    {scoped ? (
                        <p className="py-3 text-xs text-fg-muted">
                            « Dû aux membres » ne compte ici que les membres de {liabilitiesScope}. Les passerelles, elles, sont globales :
                            la marge n’est calculée que pour « Tous les pays ».
                        </p>
                    ) : (
                        <div className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-baseline sm:justify-between">
                            <p className="text-fg-muted">
                                Tout converti en francs (1 $ = {USD_TO_XAF_RATE} F) : détenu{' '}
                                <span className="font-medium text-fg tabular-nums">{formatMoney(totalExternalCombinedXAF)}</span>
                            </p>
                            <p className="text-fg-muted">
                                Marge totale{' '}
                                <span className={cn('font-semibold tabular-nums', combinedMargin >= 0 ? 'text-success' : 'text-danger')}>
                                    {combinedMargin > 0 ? '+' : ''}{formatMoney(combinedMargin)}
                                </span>
                            </p>
                        </div>
                    )}
                </div>

                {balances?.lastUpdatedAt && (
                    <p className="text-xs text-fg-subtle">
                        Soldes saisis mis à jour le {formatDateTime(balances.lastUpdatedAt)}{balances.notes ? ` · ${balances.notes}` : ''}
                    </p>
                )}
            </PanelBody>

            <Dialog open={isEditing} onOpenChange={open => { if (!open && !isSaving) setIsEditing(false); }}>
                {isEditing && (
                    <DialogContent
                        title="Modifier les soldes saisis"
                        description="Pour les passerelles sans API de solde, ou quand l’API ne répond pas. Les soldes en direct ne changent pas."
                        footer={(
                            <>
                                <DialogClose asChild><Button size="lg" disabled={isSaving}>Annuler</Button></DialogClose>
                                <Button variant="primary" size="lg" loading={isSaving} onClick={handleSave}>Enregistrer</Button>
                            </>
                        )}
                    >
                        <div className="grid gap-4">
                            <Field label="NOWPayments (USD)">
                                <Input type="number" inputMode="decimal" step="0.01" min="0" className="h-11"
                                    value={editForm.nowpaymentsBalanceUSD}
                                    onChange={e => setEditForm({ ...editForm, nowpaymentsBalanceUSD: parseFloat(e.target.value) || 0 })} />
                            </Field>
                            <Field label="FeexPay (F)">
                                <Input type="number" inputMode="numeric" step="1" min="0" className="h-11"
                                    value={editForm.feexpayBalanceXAF}
                                    onChange={e => setEditForm({ ...editForm, feexpayBalanceXAF: parseFloat(e.target.value) || 0 })} />
                            </Field>
                            <Field label="CinetPay (F)">
                                <Input type="number" inputMode="numeric" step="1" min="0" className="h-11"
                                    value={editForm.cinetpayBalanceXAF}
                                    onChange={e => setEditForm({ ...editForm, cinetpayBalanceXAF: parseFloat(e.target.value) || 0 })} />
                            </Field>
                            <Field label="Note (facultatif)">
                                <Input className="h-11" placeholder="Ex. : relevé du 16/11/2026" value={editForm.notes}
                                    onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
                            </Field>
                            {error && <p className="text-sm text-danger">{error}</p>}
                        </div>
                    </DialogContent>
                )}
            </Dialog>
        </Panel>
    );
};

export default GatewayBalancesCard;
