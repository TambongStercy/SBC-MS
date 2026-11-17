import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    Alert02Icon, BulbIcon, CancelCircleIcon, CheckmarkCircle02Icon, PencilEdit01Icon, Search01Icon, UserSearch01Icon,
} from '@hugeicons/core-free-icons';
import ConfirmationModal from '../components/common/ConfirmationModal';
import {
    createManualPaymentIntent,
    recoverExistingPaymentIntent,
    searchPaymentIntent,
    searchUsersForFeexPayFix,
    ManualPaymentIntentRequest,
    ManualPaymentIntentResponse,
    SubscriptionType,
} from '../services/adminPaymentApi';
import { AdminUserData } from '../services/adminUserApi';
import { getAvatarUrl } from '../api/apiClient';
import { Can } from '../components/Can';
import { usePageFilters } from '../hooks/usePageFilters';
import { PaymentsFilterRow } from '../components/payments/PaymentsFilterRow';
import {
    Avatar, Badge, Button, Checkbox, EmptyState, Field, Input, PageHeader, Panel, PanelHeader, ResponsiveList, Segmented, Textarea, type ListColumn,
} from '../components/ui';
import { cn } from '../lib/cn';
import { ErrorState, FilterBar } from '../components/common/DataStates';
import { formatDateTime, formatMoney } from '../components/common/format';
import { CheckFirst, CopyValue, DetailRow, SearchInput } from '../components/payments/shared';
import { useUrlSearchAndPage } from '../components/payments/useUrlSearchAndPage';

/** Payment intent statuses as shown to the admin. */
const INTENT_STATUS_LABELS: Record<string, string> = {
    SUCCEEDED: 'Réussi',
    FAILED: 'Échoué',
    PENDING: 'En attente',
    PENDING_USER_INPUT: 'En attente du membre',
    PENDING_PROVIDER: 'En attente du fournisseur',
    PROCESSING: 'En cours',
    CANCELED: 'Annulé',
    CANCELLED: 'Annulé',
    EXPIRED: 'Expiré',
    REQUIRES_ACTION: 'Action requise',
    ERROR: 'Erreur',
};
const intentStatusLabel = (s: string) => INTENT_STATUS_LABELS[s] ?? s;
const intentTone = (s: string) => (s === 'SUCCEEDED' ? 'success' : s === 'FAILED' || s === 'ERROR' ? 'danger' : s === 'CANCELED' || s === 'CANCELLED' || s === 'EXPIRED' ? 'neutral' : 'warning') as 'success' | 'danger' | 'neutral' | 'warning';

const SUBSCRIPTION_LABELS: Record<string, string> = { CLASSIQUE: 'Classique', CIBLE: 'Ciblé', UPGRADE: 'Mise à niveau vers Ciblé' };

/** What GET /payments/admin/search-payment-intent returns. */
interface FoundIntent {
    sessionId: string;
    status: string;
    amount: number;
    currency: string;
    gateway: string;
    gatewayPaymentId?: string;
    userId: string;
    userName?: string;
    userEmail?: string;
    createdAt: string;
    canRecover: boolean;
}

type Provider = 'cinetpay' | 'feexpay' | 'nowpayments';
type Plan = 'CLASSIQUE' | 'CIBLE' | 'UPGRADE';
type Mode = 'find' | 'create';

// Configuration des prix d'abonnement
const SUBSCRIPTION_PRICING = {
    cinetpay: {
        currency: 'XAF',
        plans: {
            CLASSIQUE: { amount: 2070, label: 'Classique (2 070 XAF)' },
            CIBLE: { amount: 5140, label: 'Ciblé (5 140 XAF)' },
            UPGRADE: { amount: 3070, label: 'Mise à niveau (3 070 XAF)' }
        }
    },
    feexpay: {
        currency: 'XAF',
        plans: {
            CLASSIQUE: { amount: 2070, label: 'Classique (2 070 XAF)' },
            CIBLE: { amount: 5140, label: 'Ciblé (5 140 XAF)' },
            UPGRADE: { amount: 3070, label: 'Mise à niveau (3 070 XAF)' }
        }
    },
    nowpayments: {
        currency: 'USD',
        plans: {
            CLASSIQUE: { amount: 4.8, label: 'Classique (4,8 $)' }, // TODO: Import from config
            CIBLE: { amount: 11.6, label: 'Ciblé (11,6 $)' }, // TODO: Import from config
            UPGRADE: { amount: 7, label: 'Mise à niveau (7 $)' } // TODO: Import from config
        }
    }
};

const EMPTY_FORM = {
    provider: 'cinetpay' as Provider,
    subscriptionType: 'CLASSIQUE' as Plan,
    externalReference: '',
    adminNote: '',
    autoMarkSucceeded: true,
    triggerWebhook: true
};

// Get available subscription options based on current user subscriptions
const getAvailableSubscriptionOptions = (userSubscriptions: SubscriptionType[]): { value: Plan; label: string; hint: string; disabled?: boolean }[] => {
    const hasClassique = userSubscriptions.includes(SubscriptionType.CLASSIQUE);
    const hasCible = userSubscriptions.includes(SubscriptionType.CIBLE);
    const options: { value: Plan; label: string; hint: string }[] = [
        { value: 'CLASSIQUE', label: 'Classique', hint: 'Ciblage par pays, à vie' },
        { value: 'CIBLE', label: 'Ciblé', hint: 'Ciblage avancé, tous critères, à vie' },
        { value: 'UPGRADE', label: 'Mise à niveau', hint: 'De Classique à Ciblé, à vie' },
    ];
    if (hasCible) return options.map(o => ({ ...o, disabled: true })); // User has CIBLE, can't do any subscription
    if (hasClassique) return options.map(o => ({ ...o, disabled: o.value !== 'UPGRADE' })); // can only upgrade
    return options.map(o => ({ ...o, disabled: o.value === 'UPGRADE' })); // no subscription: CLASSIQUE or CIBLE
};

const getSubscriptionDisplayText = (subscriptions: SubscriptionType[]): string =>
    !subscriptions || subscriptions.length === 0 ? 'Aucun abonnement actif' : subscriptions.join(', ');

/**
 * A member paid and their subscription was not activated: find the existing
 * payment and recover it, or create one by hand. Both grant a lifetime
 * subscription and pay referral commissions, so both ask first.
 */
function ManualPaymentRecoveryPage() {
    const [params, setParams] = useSearchParams();
    const recoveryMode: Mode = params.get('mode') === 'create' ? 'create' : 'find';
    const setRecoveryMode = (m: Mode) => setParams(prev => {
        const p = new URLSearchParams();
        const country = prev.get('pays');
        if (country) p.set('pays', country);
        if (m === 'create') p.set('mode', 'create');
        return p;
    }, { replace: true });
    // Country narrows the member search (create mode). The reference lookup and
    // the period make no sense here, so the find mode shows no filter row.
    const filters = usePageFilters();

    // Member search (create mode): text in the URL (`q`).
    const memberSearch = useUrlSearchAndPage();
    const [selectedUser, setSelectedUser] = useState<AdminUserData | null>(null);
    const usersQuery = useQuery({
        queryKey: ['payments-recovery-member-search', memberSearch.q, filters.country],
        queryFn: () => searchUsersForFeexPayFix(memberSearch.q, filters.country || undefined),
        enabled: recoveryMode === 'create' && memberSearch.q !== '' && !selectedUser,
    });
    useEffect(() => {
        if (usersQuery.isError) toast.error('La recherche de membres a échoué.');
    }, [usersQuery.isError]);

    // Find mode
    const [searchReference, setSearchReference] = useState('');
    const [foundPaymentIntent, setFoundPaymentIntent] = useState<FoundIntent | null>(null);
    const [isSearching, setIsSearching] = useState(false);

    // Form state
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [isCreating, setIsCreating] = useState(false);
    // Both actions grant a lifetime subscription and pay commissions: ask first.
    const [confirmAction, setConfirmAction] = useState<'create' | 'recover' | null>(null);
    const [creationResult, setCreationResult] = useState<ManualPaymentIntentResponse | null>(null);

    const handleSearchPaymentIntent = async () => {
        if (!searchReference.trim()) {
            toast.error('Veuillez entrer une référence de paiement');
            return;
        }
        setIsSearching(true);
        const toastId = toast.loading('Recherche de l\'intention de paiement…');
        try {
            const result = await searchPaymentIntent(searchReference.trim());
            if (result.success && result.data) {
                setFoundPaymentIntent(result.data);
                toast.success('Intention de paiement trouvée', { id: toastId });
            } else {
                setFoundPaymentIntent(null);
                toast.error(result.message || 'Intention de paiement non trouvée', { id: toastId });
            }
        } catch (error: unknown) {
            console.error("Erreur lors de la recherche:", error);
            setFoundPaymentIntent(null);
            toast.error((error instanceof Error ? error.message : '') || "Erreur lors de la recherche", { id: toastId });
        } finally {
            setIsSearching(false);
        }
    };

    const handleRecoverPaymentIntent = async () => {
        if (!foundPaymentIntent) {
            toast.error('Aucune intention de paiement sélectionnée pour récupération');
            return;
        }
        if (!foundPaymentIntent.canRecover) {
            toast.error('Cette intention de paiement ne peut pas être récupérée (déjà réussie)');
            return;
        }
        setIsCreating(true);
        const toastId = toast.loading('Récupération de l\'intention de paiement…');
        try {
            const result = await recoverExistingPaymentIntent(
                foundPaymentIntent.sessionId,
                `Récupération admin - Référence: ${searchReference}`
            );
            setCreationResult(result);
            toast.success('Intention de paiement récupérée', { id: toastId });
            setSearchReference('');
            setFoundPaymentIntent(null);
        } catch (error: unknown) {
            console.error("Erreur lors de la récupération:", error);
            toast.error((error instanceof Error ? error.message : '') || "Échec de récupération", { id: toastId });
        } finally {
            setIsCreating(false);
        }
    };

    const handleUserSelect = (user: AdminUserData) => {
        setSelectedUser(user);
        memberSearch.clear();
        // Auto-select appropriate subscription type based on user's current subscriptions
        const validOptions = getAvailableSubscriptionOptions(user.activeSubscriptionTypes || []).filter(opt => !opt.disabled);
        if (validOptions.length > 0) {
            setFormData(prev => ({ ...prev, subscriptionType: validOptions[0].value }));
        }
    };

    const handleFormChange = <K extends keyof typeof EMPTY_FORM>(field: K, value: (typeof EMPTY_FORM)[K]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const getCurrentPricing = () => SUBSCRIPTION_PRICING[formData.provider].plans[formData.subscriptionType];
    const getCurrentCurrency = () => SUBSCRIPTION_PRICING[formData.provider].currency;

    const handleCreatePaymentIntent = async () => {
        if (!selectedUser) {
            toast.error('Sélectionnez d\'abord un membre');
            return;
        }
        // Check if the selected subscription type is valid for this user
        const selectedOption = getAvailableSubscriptionOptions(selectedUser.activeSubscriptionTypes || []).find(opt => opt.value === formData.subscriptionType);
        if (!selectedOption || selectedOption.disabled) {
            toast.error('Ce type d\'abonnement n\'est pas possible pour ce membre');
            return;
        }

        const pricing = getCurrentPricing();
        setIsCreating(true);
        const toastId = toast.loading('Création de l\'intention de paiement…');

        try {
            const requestData: ManualPaymentIntentRequest = {
                userId: selectedUser._id,
                amount: pricing.amount,
                currency: getCurrentCurrency(),
                paymentType: 'SUBSCRIPTION',
                provider: formData.provider,
                externalReference: formData.externalReference || undefined,
                metadata: {
                    subscriptionType: formData.subscriptionType,
                    subscriptionPlan: formData.subscriptionType === 'CLASSIQUE' ? 'Abonnement Classique' :
                                      formData.subscriptionType === 'CIBLE' ? 'Abonnement Ciblé' :
                                      formData.subscriptionType === 'UPGRADE' ? 'Upgrade to Ciblé' : 'Subscription',
                    manualRecovery: true,
                    adminCreated: new Date().toISOString(),
                    isLifetime: true // Mark as lifetime subscription
                },
                autoMarkSucceeded: formData.autoMarkSucceeded,
                triggerWebhook: formData.triggerWebhook,
                adminNote: formData.adminNote || `Récupération manuelle pour ${selectedUser.name} - Abonnement à vie ${formData.subscriptionType}`
            };

            const result = await createManualPaymentIntent(requestData);
            setCreationResult(result);
            toast.success('Intention de paiement créée', { id: toastId });
            setFormData(EMPTY_FORM);
            setSelectedUser(null);
        } catch (error: unknown) {
            console.error("Erreur lors de la création de l'intention de paiement:", error);
            toast.error((error instanceof Error ? error.message : '') || "Échec de création de l'intention de paiement", { id: toastId });
        } finally {
            setIsCreating(false);
        }
    };

    // "Changer de membre": back to the start of the create flow.
    const resetForm = () => {
        setSelectedUser(null);
        setCreationResult(null);
        setFoundPaymentIntent(null);
        setSearchReference('');
        setFormData(EMPTY_FORM);
        setRecoveryMode('create');
    };

    const users = recoveryMode === 'create' && memberSearch.q && !selectedUser ? usersQuery.data ?? [] : [];
    const userOptions = selectedUser ? getAvailableSubscriptionOptions(selectedUser.activeSubscriptionTypes || []) : [];
    const noOptionLeft = selectedUser && userOptions.every(o => o.disabled);

    const identity = (u: AdminUserData) => (
        <div className="flex min-w-0 items-center gap-3">
            <Avatar src={getAvatarUrl(u.avatar)} name={u.name || '?'} size="sm" />
            <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{u.name || 'Sans nom'}</p>
                <p className="truncate text-xs text-fg-muted">{u.email || '—'}</p>
            </div>
        </div>
    );
    const memberColumns: ListColumn<AdminUserData>[] = [
        { key: 'member', header: 'Membre', cell: identity },
        { key: 'phone', header: 'Téléphone', cell: u => <span className="font-mono text-sm">{u.phoneNumber || '—'}</span> },
        { key: 'subs', header: 'Abonnement', cell: u => <span className="text-sm text-fg-muted">{getSubscriptionDisplayText(u.activeSubscriptionTypes || [])}</span> },
        {
            key: 'pick', header: <span className="sr-only">Choisir</span>, className: 'text-right', hideOnCard: true,
            cell: u => <Button variant="soft" size="sm" onClick={e => { e.stopPropagation(); handleUserSelect(u); }}>Sélectionner</Button>,
        },
    ];

    const fi = foundPaymentIntent;
    const cr = creationResult?.data;

    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                className="mb-0"
                title="Récupération de paiement"
                description="Un membre a payé mais son abonnement n’a pas été activé : retrouvez son paiement pour le récupérer, ou créez-le à la main."
            />

            <CheckFirst icon={Alert02Icon} title="Seulement si l’argent est bien arrivé">
                <p>
                    Vérifiez-le chez le fournisseur avant d’agir : le membre reçoit un abonnement à vie et ses parrains leurs commissions.
                    Un paiement « en attente du fournisseur » est le plus souvent abandonné, pas payé ; le contrôle automatique le revérifie toutes les 10 minutes.
                </p>
            </CheckFirst>

            {cr && (
                <Panel className="border-success/40" role="status">
                    <PanelHeader
                        title={<span className="flex items-center gap-2"><HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} aria-hidden="true" className="text-success" />Paiement enregistré</span>}
                        description={creationResult?.message}
                        actions={<Button variant="outline" size="md" className="h-11 sm:h-9" onClick={() => setCreationResult(null)}>Créer une autre</Button>}
                    />
                    <dl className="divide-y divide-line px-5 pb-4">
                        <DetailRow label="Statut"><Badge tone={intentTone(cr.status)}>{intentStatusLabel(cr.status)}</Badge></DetailRow>
                        <DetailRow label="Membre">{cr.userName || '—'}{cr.userEmail ? ` · ${cr.userEmail}` : ''}</DetailRow>
                        <DetailRow label="Montant"><span className="tabular-nums">{formatMoney(cr.amount, cr.currency)}</span></DetailRow>
                        <DetailRow label="Fournisseur">{cr.gateway}</DetailRow>
                        <DetailRow label="Type d’abonnement">{SUBSCRIPTION_LABELS[cr.subscriptionProcessing?.subscriptionType] ?? cr.subscriptionProcessing?.subscriptionType ?? '—'}</DetailRow>
                        <DetailRow label="Webhook déclenché">{cr.webhookTriggered ? <Badge tone="success">Oui</Badge> : <Badge tone="danger">Non</Badge>}</DetailRow>
                        <DetailRow label="Traitement de l’abonnement">{cr.subscriptionProcessing?.webhookConfigured ? <Badge tone="success">Configuré</Badge> : <Badge tone="danger">Non configuré</Badge>}</DetailRow>
                        <DetailRow label="ID de session"><CopyValue value={cr.sessionId} label="Copier l’ID de session" /></DetailRow>
                        <DetailRow label="ID membre"><CopyValue value={cr.userId} label="Copier l’ID du membre" /></DetailRow>
                        {cr.gatewayPaymentId && <DetailRow label="ID de paiement fournisseur"><CopyValue value={cr.gatewayPaymentId} label="Copier l’ID fournisseur" /></DetailRow>}
                    </dl>
                </Panel>
            )}

            <Segmented<Mode>
                label="Mode de récupération"
                size="lg"
                fill
                className="sm:inline-flex sm:w-auto sm:self-start sm:[&>button]:flex-none"
                value={recoveryMode}
                onValueChange={setRecoveryMode}
                options={[
                    { value: 'find', label: <><span className="sm:hidden">Retrouver</span><span className="hidden sm:inline">Retrouver un paiement</span></>, icon: Search01Icon },
                    { value: 'create', label: <><span className="sm:hidden">Créer</span><span className="hidden sm:inline">Créer un paiement</span></>, icon: PencilEdit01Icon },
                ]}
            />

            {recoveryMode === 'find' && (
                <Panel>
                    <PanelHeader title="Retrouver le paiement" description="Par l’ID de session SBC ou l’ID de paiement du fournisseur." />
                    <form
                        className="flex flex-col gap-2 px-5 pb-4 sm:flex-row"
                        onSubmit={e => { e.preventDefault(); void handleSearchPaymentIntent(); }}
                    >
                        <Input
                            aria-label="Référence du paiement"
                            placeholder="ID de session ou ID de paiement du fournisseur…"
                            className="h-11 sm:h-9"
                            value={searchReference}
                            onChange={e => setSearchReference(e.target.value)}
                        />
                        <Button type="submit" variant="primary" className="h-11 sm:h-9" loading={isSearching} disabled={!searchReference.trim()}>
                            {!isSearching && <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />}
                            {isSearching ? 'Recherche…' : 'Chercher'}
                        </Button>
                    </form>

                    {fi ? (
                        <div className="border-t border-line px-5 py-4">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-fg">Paiement trouvé</p>
                                <Badge tone={intentTone(fi.status)}>{intentStatusLabel(fi.status)}</Badge>
                            </div>
                            <dl className="divide-y divide-line">
                                <DetailRow label="Membre">{fi.userName || '—'}</DetailRow>
                                <DetailRow label="E-mail du membre">{fi.userEmail || '—'}</DetailRow>
                                <DetailRow label="Montant"><span className="font-medium tabular-nums">{formatMoney(fi.amount, fi.currency)}</span></DetailRow>
                                <DetailRow label="Fournisseur">{fi.gateway}</DetailRow>
                                <DetailRow label="Créé le">{formatDateTime(fi.createdAt)}</DetailRow>
                                <DetailRow label="ID de session"><CopyValue value={fi.sessionId} label="Copier l’ID de session" /></DetailRow>
                                {fi.gatewayPaymentId && <DetailRow label="ID de paiement fournisseur"><CopyValue value={fi.gatewayPaymentId} label="Copier l’ID fournisseur" /></DetailRow>}
                                <DetailRow label="ID membre"><CopyValue value={fi.userId} label="Copier l’ID du membre" /></DetailRow>
                            </dl>
                            {fi.canRecover ? (
                                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <span className="inline-flex items-center gap-1.5 text-sm text-success"><HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />Ce paiement peut être récupéré</span>
                                    <Can module="payments" write fallback={<span className="text-xs text-fg-subtle">Lecture seule</span>}>
                                        <Button variant="primary" size="lg" className="w-full sm:w-auto" loading={isCreating} onClick={() => setConfirmAction('recover')}>
                                            {!isCreating && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />}
                                            {isCreating ? 'Récupération…' : 'Récupérer ce paiement'}
                                        </Button>
                                    </Can>
                                </div>
                            ) : (
                                <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-danger"><HugeiconsIcon icon={CancelCircleIcon} size={16} aria-hidden="true" />Ce paiement ne peut pas être récupéré (déjà réussi).</p>
                            )}
                        </div>
                    ) : (
                        <EmptyState
                            className="border-t border-line py-8"
                            icon={Search01Icon}
                            title="Collez la référence du paiement"
                            description="Si le paiement n’existe pas chez SBC, passez à « Créer un paiement »."
                        />
                    )}
                </Panel>
            )}

            {recoveryMode === 'create' && !selectedUser && <PaymentsFilterRow filters={filters} hidePeriod note={false} />}

            {recoveryMode === 'create' && (
                <Panel>
                    <PanelHeader title="1. Le membre" description={selectedUser ? undefined : 'Celui qui a payé.'} />
                    {selectedUser ? (
                        <div className="flex flex-col gap-3 px-5 pb-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                                <Avatar src={getAvatarUrl(selectedUser.avatar)} name={selectedUser.name || '?'} size="md" />
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-fg">{selectedUser.name}</p>
                                    <p className="truncate text-xs text-fg-muted">{selectedUser.email}{selectedUser.phoneNumber ? ` · ${selectedUser.phoneNumber}` : ''}</p>
                                    <p className="mt-1 text-xs text-fg-muted">Abonnement : <span className="text-fg">{getSubscriptionDisplayText(selectedUser.activeSubscriptionTypes || [])}</span></p>
                                </div>
                            </div>
                            <Button variant="outline" className="h-11 sm:h-9" onClick={resetForm}>Changer de membre</Button>
                        </div>
                    ) : (
                        <>
                            <div className="px-5 pb-4">
                                <FilterBar active={!!memberSearch.input && !filters.isFiltered} onClear={memberSearch.clear}>
                                    <SearchInput value={memberSearch.input} onChange={memberSearch.setInput} label="Rechercher un membre" placeholder="Nom, e-mail ou téléphone" />
                                </FilterBar>
                            </div>
                            <ResponsiveList
                                rows={users}
                                columns={memberColumns}
                                rowKey={u => u._id}
                                className="border-t border-line"
                                onRowClick={handleUserSelect}
                                loading={memberSearch.q !== '' && usersQuery.isLoading}
                                card={u => (
                                    <div className="space-y-2">
                                        {identity(u)}
                                        <p className="text-xs text-fg-muted">{u.phoneNumber || 'Aucun téléphone'} · {getSubscriptionDisplayText(u.activeSubscriptionTypes || [])}</p>
                                    </div>
                                )}
                                empty={!memberSearch.q ? (
                                    <EmptyState icon={UserSearch01Icon} title="Commencez à taper pour rechercher un membre" />
                                ) : usersQuery.isError ? (
                                    <ErrorState title="La recherche a échoué" onRetry={() => void usersQuery.refetch()} retrying={usersQuery.isFetching} />
                                ) : (
                                    <EmptyState title={`Aucun membre ne correspond à « ${memberSearch.q} »`} description="Essayez l’e-mail ou le numéro de téléphone." />
                                )}
                            />
                        </>
                    )}
                </Panel>
            )}

            {recoveryMode === 'create' && selectedUser && (
                <Panel>
                    <PanelHeader title="2. Le paiement" description="Ce qu’il a payé, et chez quel fournisseur." />
                    <div className="space-y-5 px-5 pb-4">
                        <Field label="Fournisseur de paiement">
                            <div>
                                <Segmented<Provider>
                                    label="Fournisseur de paiement"
                                    size="lg"
                                    fill
                                    className="sm:inline-flex sm:w-auto sm:self-start sm:[&>button]:flex-none"
                                    value={formData.provider}
                                    onValueChange={v => handleFormChange('provider', v)}
                                    options={[
                                        { value: 'cinetpay', label: 'CinetPay' },
                                        { value: 'feexpay', label: 'FeexPay' },
                                        { value: 'nowpayments', label: 'NOWPayments' },
                                    ]}
                                />
                            </div>
                        </Field>

                        <fieldset>
                            <legend className="mb-1.5 text-sm font-medium text-fg">Abonnement (à vie)</legend>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                {userOptions.map(o => {
                                    const price = SUBSCRIPTION_PRICING[formData.provider].plans[o.value];
                                    const checked = formData.subscriptionType === o.value;
                                    return (
                                        <label
                                            key={o.value}
                                            className={cn(
                                                'flex min-h-[44px] cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors',
                                                checked && !o.disabled ? 'border-primary bg-primary-soft/40' : 'border-line hover:border-line-strong',
                                                o.disabled && 'cursor-not-allowed opacity-50 hover:border-line',
                                            )}
                                        >
                                            <input
                                                type="radio"
                                                name="subscriptionType"
                                                value={o.value}
                                                checked={checked}
                                                disabled={o.disabled}
                                                onChange={() => handleFormChange('subscriptionType', o.value)}
                                                className="mt-1 accent-[var(--primary)]"
                                            />
                                            <span className="min-w-0">
                                                <span className="block text-sm font-medium text-fg">{o.label}</span>
                                                <span className="block text-xs text-fg-muted">{o.hint}</span>
                                                <span className="mt-1 block text-sm tabular-nums text-fg">{formatMoney(price.amount, SUBSCRIPTION_PRICING[formData.provider].currency)}</span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                            {noOptionLeft && (
                                <p className="mt-2 flex items-start gap-1.5 text-sm text-danger">
                                    <HugeiconsIcon icon={Alert02Icon} size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                                    Ce membre a déjà l’abonnement Ciblé et ne peut pas bénéficier d’autres abonnements.
                                </p>
                            )}
                            {selectedUser.activeSubscriptionTypes?.includes(SubscriptionType.CLASSIQUE) && !selectedUser.activeSubscriptionTypes?.includes(SubscriptionType.CIBLE) && (
                                <p className="mt-2 flex items-start gap-1.5 text-sm text-fg-muted">
                                    <HugeiconsIcon icon={BulbIcon} size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
                                    Ce membre a l’abonnement Classique : seule la mise à niveau vers Ciblé est possible.
                                </p>
                            )}
                        </fieldset>

                        <Field label="Référence externe" help="Référence du paiement chez le fournisseur (facultatif).">
                            <Input
                                className="h-11 font-mono sm:h-9"
                                value={formData.externalReference}
                                onChange={e => handleFormChange('externalReference', e.target.value)}
                            />
                        </Field>

                        <Field label="Note de l’admin">
                            <Textarea
                                rows={3}
                                value={formData.adminNote}
                                onChange={e => handleFormChange('adminNote', e.target.value)}
                                placeholder={`Exemple : le membre a payé via ${formData.provider} mais l'inscription a échoué. Paiement récupéré avec la référence : ${formData.externalReference || 'ABC123'}`}
                            />
                        </Field>

                        <div className="space-y-1">
                            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-fg">
                                <Checkbox checked={formData.autoMarkSucceeded} onCheckedChange={v => handleFormChange('autoMarkSucceeded', v === true)} />
                                Marquer automatiquement comme réussi (recommandé)
                            </label>
                            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-fg">
                                <Checkbox checked={formData.triggerWebhook} onCheckedChange={v => handleFormChange('triggerWebhook', v === true)} />
                                Activer l’abonnement à vie et verser les commissions (recommandé)
                            </label>
                        </div>
                    </div>

                    {/* Sticky on phones: the form is long. */}
                    <div className="sticky bottom-0 flex flex-col gap-2 rounded-b-panel border-t border-line bg-surface px-5 py-3 sm:static sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-fg-muted">
                            {SUBSCRIPTION_LABELS[formData.subscriptionType]} · <span className="font-medium tabular-nums text-fg">{formatMoney(getCurrentPricing().amount, getCurrentCurrency())}</span> · {formData.provider}
                        </p>
                        <Can module="payments" write fallback={<span className="text-xs text-fg-subtle">Lecture seule</span>}>
                            <Button variant="primary" size="lg" className="w-full sm:w-auto" loading={isCreating} disabled={!!noOptionLeft} onClick={() => setConfirmAction('create')}>
                                {isCreating ? 'Création…' : 'Créer le paiement'}
                            </Button>
                        </Can>
                    </div>
                </Panel>
            )}

            <ConfirmationModal
                isOpen={confirmAction !== null}
                variant="success"
                title={confirmAction === 'recover' ? 'Récupérer ce paiement ?' : 'Créer ce paiement ?'}
                message={
                    <div className="space-y-1 text-sm">
                        {confirmAction === 'create' && selectedUser && (
                            <>
                                <p><span className="text-fg-muted">Membre :</span> <span className="text-fg">{selectedUser.name}</span></p>
                                <p><span className="text-fg-muted">Abonnement :</span> <span className="text-fg">{SUBSCRIPTION_LABELS[formData.subscriptionType]} ({formatMoney(getCurrentPricing().amount, getCurrentCurrency())}, {formData.provider})</span></p>
                            </>
                        )}
                        {confirmAction === 'recover' && fi && (
                            <>
                                <p><span className="text-fg-muted">Membre :</span> <span className="text-fg">{fi.userName || '—'}</span></p>
                                <p><span className="text-fg-muted">Paiement :</span> <span className="break-all font-mono text-fg">{fi.sessionId}</span></p>
                            </>
                        )}
                        <p className="pt-2 text-fg-muted">Le membre reçoit un abonnement à vie et les commissions sont versées aux parrains. Faites-le seulement si le paiement a bien été reçu.</p>
                    </div>
                }
                confirmText={confirmAction === 'recover' ? 'Récupérer' : 'Créer le paiement'}
                onConfirm={async () => {
                    if (confirmAction === 'recover') await handleRecoverPaymentIntent();
                    else if (confirmAction === 'create') await handleCreatePaymentIntent();
                    setConfirmAction(null);
                }}
                onCancel={() => setConfirmAction(null)}
            />
        </div>
    );
}

export default ManualPaymentRecoveryPage;
