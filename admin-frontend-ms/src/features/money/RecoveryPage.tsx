import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { createManualPaymentIntent, recoverExistingPaymentIntent, searchPaymentIntent } from '../../services/adminPaymentApi';
import { MemberPicker } from '../members/MemberPicker';
import { getMember, type Member } from '../members/api';
import { Badge, Button, Card, ConfirmSheet, Input, KeyValue, Page, SectionTitle, Select, StatusBadge, Tabs, Textarea, notify } from '../../ui';
import { formatDateTime, formatMoney } from '../../lib/format';
import { PAYMENT_STATUS, gatewayLabel, paymentTypeLabel } from '../../lib/labels';
import { errorMessage } from '../../lib/hooks';

/**
 * Subscription prices by provider, as members pay them (mobile money includes
 * the provider's fee — hence 2 070, not the 2 150 of the activation balance).
 * Unchanged from the previous recovery page.
 */
const PRICING = {
    cinetpay: { currency: 'XAF', plans: { CLASSIQUE: 2070, CIBLE: 5140, UPGRADE: 3070 } },
    feexpay: { currency: 'XAF', plans: { CLASSIQUE: 2070, CIBLE: 5140, UPGRADE: 3070 } },
    nowpayments: { currency: 'USD', plans: { CLASSIQUE: 4.8, CIBLE: 11.6, UPGRADE: 7 } },
} as const;
type Provider = keyof typeof PRICING;
type Plan = 'CLASSIQUE' | 'CIBLE' | 'UPGRADE';
const PLAN_NAME: Record<Plan, string> = { CLASSIQUE: 'Classique', CIBLE: 'Ciblé', UPGRADE: 'Passage de Classique à Ciblé' };
const PLAN_META: Record<Plan, string> = { CLASSIQUE: 'Abonnement Classique', CIBLE: 'Abonnement Ciblé', UPGRADE: 'Upgrade to Ciblé' };

/** What this member can still buy: nothing if Ciblé, the upgrade if Classique. */
function plansFor(m: Member | null): Plan[] {
    const subs = m?.activeSubscriptionTypes ?? [];
    if (subs.includes('CIBLE')) return [];
    if (subs.includes('CLASSIQUE')) return ['UPGRADE'];
    return ['CLASSIQUE', 'CIBLE'];
}

function CreateTab({ initialMember }: { initialMember: Member | null }) {
    const [member, setMember] = useState<Member | null>(initialMember);
    const [provider, setProvider] = useState<Provider>('cinetpay');
    const [plan, setPlan] = useState<Plan>('CLASSIQUE');
    const [reference, setReference] = useState('');
    const [note, setNote] = useState('');
    const [confirm, setConfirm] = useState(false);
    useEffect(() => { setMember(initialMember); }, [initialMember]);
    const plans = plansFor(member);
    useEffect(() => { if (plans.length && !plans.includes(plan)) setPlan(plans[0]); }, [plans, plan]);
    const price = PRICING[provider].plans[plan];
    const currency = PRICING[provider].currency;

    return (
        <div className="space-y-4">
            <SectionTitle>Le membre</SectionTitle>
            <MemberPicker value={member} onChange={setMember} />
            {member && (
                plans.length === 0 ? (
                    <Card className="text-sm text-ink-2">{member.name} a déjà l’abonnement Ciblé : il n’y a rien à récupérer.</Card>
                ) : (
                    <Card className="space-y-4">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <Select label="Abonnement payé" value={plan} onChange={e => setPlan(e.target.value as Plan)}>
                                {plans.map(p => <option key={p} value={p}>{PLAN_NAME[p]}</option>)}
                            </Select>
                            <Select label="Payé par" value={provider} onChange={e => setProvider(e.target.value as Provider)}
                                hint="MoneyFusion n’est pas encore accepté par le serveur pour une récupération.">
                                <option value="cinetpay">CinetPay</option><option value="feexpay">FeexPay</option><option value="nowpayments">NOWPayments (crypto)</option>
                            </Select>
                        </div>
                        <Input label="Référence du paiement (opérateur ou fournisseur)" value={reference} onChange={e => setReference(e.target.value)}
                            hint="Fortement conseillée : c’est la trace de ce que le membre a payé." />
                        <Textarea label="Note" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Ex. preuve du débit reçue par WhatsApp" />
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <span className="text-sm text-ink-2">Montant enregistré : <b className="text-ink tabular">{formatMoney(price, currency)}</b></span>
                            <Button variant="success" className="w-full sm:w-auto" onClick={() => setConfirm(true)}>Créer le paiement</Button>
                        </div>
                    </Card>
                )
            )}
            {member && (
                <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} tone="success" title="Créer ce paiement ?"
                    message={<>
                        <KeyValue items={[['Membre', member.name], ['Abonnement', PLAN_NAME[plan]], ['Montant', formatMoney(price, currency)], ['Payé par', gatewayLabel(provider)], ['Référence', reference || '—']]} />
                        <p>Le membre reçoit l’abonnement à vie et ses parrains touchent leurs commissions. Seulement si le paiement a bien été reçu.</p>
                    </>}
                    confirmLabel="Créer le paiement"
                    onConfirm={async () => {
                        await createManualPaymentIntent({
                            userId: member._id, amount: price, currency, paymentType: 'SUBSCRIPTION', provider,
                            externalReference: reference.trim() || undefined,
                            metadata: { subscriptionType: plan, subscriptionPlan: PLAN_META[plan], manualRecovery: true, adminCreated: new Date().toISOString(), isLifetime: true },
                            autoMarkSucceeded: true, triggerWebhook: true,
                            adminNote: note.trim() || `Récupération manuelle pour ${member.name} - Abonnement à vie ${plan}`,
                        });
                        notify.success(`Abonnement ${PLAN_NAME[plan]} activé pour ${member.name}.`);
                        setReference(''); setNote('');
                    }} />
            )}
        </div>
    );
}

function FindTab() {
    const [reference, setReference] = useState('');
    const [busy, setBusy] = useState(false);
    const [found, setFound] = useState<Record<string, any> | null>(null);
    const [error, setError] = useState('');
    const [confirm, setConfirm] = useState(false);
    const search = async () => {
        if (!reference.trim()) return;
        setBusy(true); setError(''); setFound(null);
        try {
            const r = await searchPaymentIntent(reference.trim());
            if (r.success && r.data) setFound(r.data); else setError(r.message || 'Aucun paiement avec cette référence.');
        } catch (e) {
            setError(errorMessage(e, 'Recherche impossible.'));
        } finally { setBusy(false); }
    };
    return (
        <div className="space-y-4">
            <Card className="space-y-3">
                <Input label="Référence ou session du paiement" value={reference} onChange={e => setReference(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') search(); }} hint="La session SBC, ou la référence donnée par le fournisseur." />
                <Button onClick={search} loading={busy}>Chercher</Button>
                {error && <p className="text-sm text-danger">{error}</p>}
            </Card>
            {found && (
                <Card className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold">{paymentTypeLabel(found.paymentType)} · {formatMoney(found.amount, found.currency)}</p>
                        <StatusBadge status={found.status} labels={PAYMENT_STATUS} />
                    </div>
                    <KeyValue items={[
                        ['Membre', found.userName || found.userId || '—'],
                        ['Payé par', gatewayLabel(found.gateway)],
                        ['Créé', formatDateTime(found.createdAt)],
                        ['Session', <span className="font-mono text-xs break-all">{found.sessionId}</span>],
                    ]} />
                    {found.canRecover ? (
                        <Button variant="success" full onClick={() => setConfirm(true)}>Récupérer ce paiement</Button>
                    ) : <Badge tone="success">Déjà réussi : rien à récupérer</Badge>}
                </Card>
            )}
            {found && (
                <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} tone="success" title="Récupérer ce paiement ?"
                    message={<p>Le paiement passe en réussi : le membre reçoit ce qu’il a payé et les commissions sont versées. Seulement si l’argent a bien été reçu.</p>}
                    confirmLabel="Récupérer"
                    onConfirm={async () => {
                        await recoverExistingPaymentIntent(found.sessionId, `Récupération admin - Référence: ${reference.trim()}`);
                        notify.success('Paiement récupéré.');
                        setFound(null); setReference('');
                    }} />
            )}
        </div>
    );
}

/** Give a member the subscription they paid for, when the payment never completed on our side. */
export default function RecoveryPage() {
    const [params] = useSearchParams();
    const memberId = params.get('membre');
    const [tab, setTab] = useState<'creer' | 'chercher'>('creer');
    const initial = useQuery({ queryKey: ['member', memberId], queryFn: () => getMember(memberId!), enabled: !!memberId });
    return (
        <Page title="Récupérer un abonnement payé" back="/argent/resoudre" width="narrow">
            <div className="space-y-4">
                <Tabs value={tab} onChange={setTab} items={[{ value: 'creer', label: 'Créer le paiement' }, { value: 'chercher', label: 'Retrouver un paiement' }]} />
                {tab === 'creer' ? <CreateTab initialMember={initial.data ?? null} /> : <FindTab />}
            </div>
        </Page>
    );
}
