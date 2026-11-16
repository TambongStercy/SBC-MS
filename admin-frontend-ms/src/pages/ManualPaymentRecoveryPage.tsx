import React, { useState, useEffect, useCallback } from 'react';
import ConfirmationModal from '../components/common/ConfirmationModal';
import { motion } from 'framer-motion';
import { Search, Plus, DollarSign, CheckCircle, AlertCircle } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import toast from 'react-hot-toast';
import { 
    createManualPaymentIntent, 
    searchUsersForFeexPayFix, 
    ManualPaymentIntentRequest,
    ManualPaymentIntentResponse,
    SubscriptionType
} from '../services/adminPaymentApi';
import { AdminUserData } from '../services/adminUserApi';
import { getAvatarUrl } from '../api/apiClient';
import { HugeiconsIcon } from '@hugeicons/react';
import { PencilEdit01Icon, Search01Icon, ChartBarLineIcon, Alert02Icon, BulbIcon, CheckmarkCircle02Icon, CancelCircleIcon } from '@hugeicons/core-free-icons';

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
};
const intentStatusLabel = (s: string) => INTENT_STATUS_LABELS[s] ?? s;

function ManualPaymentRecoveryPage() {
    const [searchTerm, setSearchTerm] = useState('');
    const [users, setUsers] = useState<AdminUserData[]>([]);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [selectedUser, setSelectedUser] = useState<AdminUserData | null>(null);
    const [debounceTimeout, setDebounceTimeout] = useState<NodeJS.Timeout | null>(null);
    
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

    // Recovery mode state
    const [recoveryMode, setRecoveryMode] = useState<'create' | 'find'>('create');
    const [searchReference, setSearchReference] = useState('');
    const [foundPaymentIntent, setFoundPaymentIntent] = useState<any>(null);
    const [isSearching, setIsSearching] = useState(false);

    // Form state
    const [formData, setFormData] = useState({
        provider: 'cinetpay' as 'cinetpay' | 'feexpay' | 'nowpayments',
        subscriptionType: 'CLASSIQUE' as 'CLASSIQUE' | 'CIBLE' | 'UPGRADE',
        externalReference: '',
        adminNote: '',
        autoMarkSucceeded: true,
        triggerWebhook: true
    });
    
    const [isCreating, setIsCreating] = useState(false);
    // Both actions grant a lifetime subscription and pay commissions: ask first.
    const [confirmAction, setConfirmAction] = useState<'create' | 'recover' | null>(null);
    const [creationResult, setCreationResult] = useState<ManualPaymentIntentResponse | null>(null);

    // Debounce search input
    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(event.target.value);
        setSelectedUser(null); // Clear selection when searching
        
        if (debounceTimeout) {
            clearTimeout(debounceTimeout);
        }
        const timeout = setTimeout(() => {
            if (event.target.value.trim() !== '') {
                fetchUsers(event.target.value);
            } else {
                setUsers([]);
            }
        }, 500);
        setDebounceTimeout(timeout);
    };

    const fetchUsers = useCallback(async (query: string) => {
        setLoadingUsers(true);
        try {
            const fetchedUsers = await searchUsersForFeexPayFix(query);
            setUsers(fetchedUsers);
        } catch (error) {
            toast.error("La recherche de membres a échoué.");
            console.error("Échec de recherche des utilisateurs:", error);
        } finally {
            setLoadingUsers(false);
        }
    }, []);

    const handleSearchPaymentIntent = async () => {
        if (!searchReference.trim()) {
            toast.error('Veuillez entrer une référence de paiement');
            return;
        }

        setIsSearching(true);
        const toastId = toast.loading('Recherche de l\'intention de paiement…');

        try {
            const { searchPaymentIntent } = await import('../services/adminPaymentApi');
            const result = await searchPaymentIntent(searchReference.trim());

            if (result.success && result.data) {
                setFoundPaymentIntent(result.data);
                toast.success('Intention de paiement trouvée', { id: toastId });
            } else {
                setFoundPaymentIntent(null);
                toast.error(result.message || 'Intention de paiement non trouvée', { id: toastId });
            }
        } catch (error: any) {
            console.error("Erreur lors de la recherche:", error);
            setFoundPaymentIntent(null);
            toast.error(error.message || "Erreur lors de la recherche", { id: toastId });
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
            const { recoverExistingPaymentIntent } = await import('../services/adminPaymentApi');
            const result = await recoverExistingPaymentIntent(
                foundPaymentIntent.sessionId,
                `Récupération admin - Référence: ${searchReference}`
            );

            setCreationResult(result);
            toast.success('Intention de paiement récupérée', { id: toastId });
            
            // Reset search
            setSearchReference('');
            setFoundPaymentIntent(null);
            
        } catch (error: any) {
            console.error("Erreur lors de la récupération:", error);
            toast.error(error.message || "Échec de récupération", { id: toastId });
        } finally {
            setIsCreating(false);
        }
    };

    const handleUserSelect = (user: AdminUserData) => {
        setSelectedUser(user);
        setSearchTerm(''); // Clear search
        setUsers([]); // Clear users list
        
        // Auto-select appropriate subscription type based on user's current subscriptions
        const availableOptions = getAvailableSubscriptionOptions(user.activeSubscriptionTypes || []);
        const validOptions = availableOptions.filter(opt => !opt.disabled);
        
        if (validOptions.length > 0) {
            // Set to first available option
            setFormData(prev => ({
                ...prev,
                subscriptionType: validOptions[0].value as 'CLASSIQUE' | 'CIBLE' | 'UPGRADE'
            }));
        }
    };

    const handleFormChange = (field: string, value: any) => {
        setFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    // Get current pricing based on provider and subscription type
    const getCurrentPricing = () => {
        return SUBSCRIPTION_PRICING[formData.provider].plans[formData.subscriptionType];
    };

    const getCurrentCurrency = () => {
        return SUBSCRIPTION_PRICING[formData.provider].currency;
    };

    // Get available subscription options based on current user subscriptions
    const getAvailableSubscriptionOptions = (userSubscriptions: SubscriptionType[]): { value: string; label: string; disabled?: boolean }[] => {
        const hasClassique = userSubscriptions.includes(SubscriptionType.CLASSIQUE);
        const hasCible = userSubscriptions.includes(SubscriptionType.CIBLE);
        
        if (hasCible) {
            // User has CIBLE, can't do any subscription
            return [
                { value: 'CLASSIQUE', label: 'Classique - ciblage par pays (à vie)', disabled: true },
                { value: 'CIBLE', label: 'Ciblé - ciblage avancé, tous critères (à vie)', disabled: true },
                { value: 'UPGRADE', label: 'Mise à niveau - de Classique à Ciblé (à vie)', disabled: true }
            ];
        } else if (hasClassique) {
            // User has CLASSIQUE, can only upgrade
            return [
                { value: 'CLASSIQUE', label: 'Classique - ciblage par pays (à vie)', disabled: true },
                { value: 'CIBLE', label: 'Ciblé - ciblage avancé, tous critères (à vie)', disabled: true },
                { value: 'UPGRADE', label: 'Mise à niveau - de Classique à Ciblé (à vie)', disabled: false }
            ];
        } else {
            // User has no subscription, can do CLASSIQUE or CIBLE
            return [
                { value: 'CLASSIQUE', label: 'Classique - ciblage par pays (à vie)', disabled: false },
                { value: 'CIBLE', label: 'Ciblé - ciblage avancé, tous critères (à vie)', disabled: false },
                { value: 'UPGRADE', label: 'Mise à niveau - de Classique à Ciblé (à vie)', disabled: true }
            ];
        }
    };

    // Get subscription display text
    const getSubscriptionDisplayText = (subscriptions: SubscriptionType[]): string => {
        if (!subscriptions || subscriptions.length === 0) {
            return 'Aucun abonnement actif';
        }
        return subscriptions.join(', ');
    };

    const handleCreatePaymentIntent = async () => {
        if (!selectedUser) {
            toast.error('Sélectionnez d\'abord un membre');
            return;
        }

        // Check if the selected subscription type is valid for this user
        const availableOptions = getAvailableSubscriptionOptions(selectedUser.activeSubscriptionTypes || []);
        const selectedOption = availableOptions.find(opt => opt.value === formData.subscriptionType);
        
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
            
            // Reset form
            setFormData({
                provider: 'cinetpay',
                subscriptionType: 'CLASSIQUE',
                externalReference: '',
                adminNote: '',
                autoMarkSucceeded: true,
                triggerWebhook: true
            });
            setSelectedUser(null);

        } catch (error: any) {
            console.error("Erreur lors de la création de l'intention de paiement:", error);
            toast.error(error.message || "Échec de création de l'intention de paiement", { id: toastId });
        } finally {
            setIsCreating(false);
        }
    };

    const resetForm = () => {
        setSelectedUser(null);
        setCreationResult(null);
        setFoundPaymentIntent(null);
        setSearchReference('');
        setRecoveryMode('create');
        setFormData({
            provider: 'cinetpay',
            subscriptionType: 'CLASSIQUE',
            externalReference: '',
            adminNote: '',
            autoMarkSucceeded: true,
            triggerWebhook: true
        });
    };

    return (
        <div>
            <Header title="Récupération manuelle de paiement" />
            <main>

                {/* Recovery Mode Toggle */}
                <motion.div
                    className="bg-surface rounded-xl p-6 border border-line mb-8"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1, ease: "easeInOut" }}
                >
                    <h2 className="text-lg sm:text-xl font-semibold text-fg mb-4">Mode de récupération</h2>
                    
                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={() => setRecoveryMode('create')}
                            className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-colors ${
                                recoveryMode === 'create' 
                                    ? 'bg-blue-600 text-white' 
                                    : 'bg-surface-2 text-fg-muted hover:bg-surface-3'
                            }`}
                        >
                            <HugeiconsIcon icon={PencilEdit01Icon} size={18} />
                            Créer une nouvelle intention
                        </button>
                        <button
                            onClick={() => setRecoveryMode('find')}
                            className={`inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-colors ${
                                recoveryMode === 'find' 
                                    ? 'bg-green-600 text-white' 
                                    : 'bg-surface-2 text-fg-muted hover:bg-surface-3'
                            }`}
                        >
                            <HugeiconsIcon icon={Search01Icon} size={18} />
                            Récupérer une intention existante
                        </button>
                    </div>
                    
                    <p className="text-fg-muted text-sm mt-3">
                        {recoveryMode === 'create' 
                            ? 'Créer une nouvelle intention de paiement pour un utilisateur'
                            : 'Chercher et récupérer une intention de paiement existante par ID de session ou référence de paiement'
                        }
                    </p>
                </motion.div>

                {/* Payment Intent Search Section - Only shown in 'find' mode */}
                {recoveryMode === 'find' && (
                    <motion.div
                        className="bg-surface rounded-xl p-6 border border-line mb-8"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, ease: "easeInOut" }}
                    >
                        <h2 className="text-lg sm:text-xl font-semibold text-fg mb-4 flex items-center gap-2">
                            <HugeiconsIcon icon={Search01Icon} size={20} />
                            Rechercher une intention de paiement
                        </h2>
                        
                        <div className="flex flex-wrap gap-4 mb-6">
                            <div className="flex-1 min-w-[12rem]">
                                <input
                                    type="text"
                                    placeholder="ID de session ou ID de paiement du fournisseur…"
                                    className="bg-surface border border-line-strong text-fg placeholder-fg-subtle rounded-lg px-4 py-2 w-full focus:outline-hidden focus:ring-2 focus:ring-green-500"
                                    value={searchReference}
                                    onChange={(e) => setSearchReference(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleSearchPaymentIntent()}
                                />
                            </div>
                            <button
                                onClick={handleSearchPaymentIntent}
                                disabled={isSearching || !searchReference.trim()}
                                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white px-6 py-2 rounded-lg flex items-center space-x-2 transition-colors"
                            >
                                {isSearching ? (
                                    <>
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                        <span>Recherche…</span>
                                    </>
                                ) : (
                                    <>
                                        <Search size={16} />
                                        <span>Chercher</span>
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Found Payment Intent Display */}
                        {foundPaymentIntent && (
                            <div className="bg-surface-2/50 rounded-lg p-4 mb-4">
                                <h3 className="text-lg font-semibold text-fg mb-3 flex items-center">
                                    <CheckCircle className="mr-2 text-green-600 dark:text-green-400" size={20} />
                                    Intention de paiement trouvée
                                </h3>
                                
                                <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                                    <div>
                                        <span className="text-fg-muted">ID de session :</span>
                                        <span className="text-fg font-mono ml-2">{foundPaymentIntent.sessionId}</span>
                                    </div>
                                    <div>
                                        <span className="text-fg-muted">Statut :</span>
                                        <span className={`ml-2 font-semibold ${
                                            foundPaymentIntent.status === 'SUCCEEDED' ? 'text-green-600 dark:text-green-400' : 
                                            foundPaymentIntent.status === 'FAILED' ? 'text-red-600 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'
                                        }`}>
                                            {intentStatusLabel(foundPaymentIntent.status)}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-fg-muted">Montant :</span>
                                        <span className="text-fg ml-2">{foundPaymentIntent.amount} {foundPaymentIntent.currency}</span>
                                    </div>
                                    <div>
                                        <span className="text-fg-muted">Fournisseur :</span>
                                        <span className="text-fg ml-2">{foundPaymentIntent.gateway}</span>
                                    </div>
                                    {foundPaymentIntent.gatewayPaymentId && (
                                        <div>
                                            <span className="text-fg-muted">ID de paiement fournisseur :</span>
                                            <span className="text-fg font-mono ml-2">{foundPaymentIntent.gatewayPaymentId}</span>
                                        </div>
                                    )}
                                    <div>
                                        <span className="text-fg-muted">Nom du membre :</span>
                                        <span className="text-fg ml-2">{foundPaymentIntent.userName || '—'}</span>
                                    </div>
                                    <div>
                                        <span className="text-fg-muted">E-mail du membre :</span>
                                        <span className="text-fg ml-2">{foundPaymentIntent.userEmail || '—'}</span>
                                    </div>
                                    <div>
                                        <span className="text-fg-muted">ID membre :</span>
                                        <span className="text-fg font-mono ml-2">{foundPaymentIntent.userId}</span>
                                    </div>
                                    <div>
                                        <span className="text-fg-muted">Créé le :</span>
                                        <span className="text-fg ml-2">{new Date(foundPaymentIntent.createdAt).toLocaleString('fr-FR')}</span>
                                    </div>
                                </div>

                                {foundPaymentIntent.canRecover ? (
                                    <div className="flex items-center justify-between">
                                        <span className="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm"><HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />Cette intention peut être récupérée</span>
                                        <button
                                            onClick={() => setConfirmAction('recover')}
                                            disabled={isCreating}
                                            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors"
                                        >
                                            {isCreating ? (
                                                <>
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                                    <span>Récupération…</span>
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle size={16} />
                                                    <span>Récupérer</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400 text-sm"><HugeiconsIcon icon={CancelCircleIcon} size={16} />Cette intention ne peut pas être récupérée (déjà réussie)</div>
                                )}
                            </div>
                        )}
                    </motion.div>
                )}
                
                {/* User Search Section - Only shown in 'create' mode */}
                {recoveryMode === 'create' && (
                <motion.div
                    className="bg-surface rounded-xl p-6 border border-line mb-8"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1, ease: "easeInOut" }}
                >
                    <h2 className="text-lg sm:text-xl font-semibold text-fg mb-4">
                        {selectedUser ? `Membre sélectionné : ${selectedUser.name}` : 'Rechercher un membre'}
                    </h2>
                    
                    {selectedUser ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-2/50 rounded-lg p-4">
                            <div className="flex items-center space-x-4">
                                <img
                                    src={getAvatarUrl(selectedUser.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedUser.name || 'User')}&background=random`}
                                    alt={`Avatar de ${selectedUser.name}`}
                                    className="h-12 w-12 rounded-full object-cover"
                                />
                                <div>
                                    <p className="text-fg font-medium">{selectedUser.name}</p>
                                    <p className="text-fg-muted text-sm">{selectedUser.email}</p>
                                    <p className="text-fg-muted text-sm">{selectedUser.phoneNumber || 'Aucun téléphone'}</p>
                                    <p className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 text-sm font-medium">
                                        <HugeiconsIcon icon={ChartBarLineIcon} size={16} />
                                        Abonnement : {getSubscriptionDisplayText(selectedUser.activeSubscriptionTypes || [])}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={resetForm}
                                className="bg-surface-3 hover:bg-line-strong text-fg px-4 py-2 rounded-lg transition-colors"
                            >
                                Changer de membre
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="relative w-full mb-6">
                                <input
                                    type="text"
                                    placeholder="Rechercher par nom, e-mail ou téléphone"
                                    className="bg-surface border border-line-strong text-fg placeholder-fg-subtle rounded-lg pl-10 pr-4 py-2 w-full focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                                    value={searchTerm}
                                    onChange={handleSearchChange}
                                />
                                <Search className="absolute left-3 top-2.5 text-fg-muted" size={18} />
                            </div>

                            {loadingUsers ? (
                                <div className="text-center py-4"><Loader name="Membres" /></div>
                            ) : users.length === 0 && searchTerm !== '' ? (
                                <p className="text-center text-fg-muted">Aucun membre ne correspond à « {searchTerm} ».</p>
                            ) : users.length === 0 && searchTerm === '' ? (
                                <p className="text-center text-fg-muted">Commencez à taper pour rechercher un membre.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-line">
                                        <thead>
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Avatar</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Nom</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">E-mail</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Téléphone</th>
                                                <th className="px-6 py-3 text-center text-xs font-medium text-fg-muted uppercase tracking-wider">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-line">
                                            {users.map((user) => (
                                                <tr key={user._id}>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-fg">
                                                        <img
                                                            src={getAvatarUrl(user.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}&background=random`}
                                                            alt={`Avatar de ${user.name}`}
                                                            className="h-10 w-10 rounded-full object-cover"
                                                        />
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-fg">{user.name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-fg">{user.email || '—'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-fg">{user.phoneNumber || '—'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                                                        <button
                                                            onClick={() => handleUserSelect(user)}
                                                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200"
                                                        >
                                                            Sélectionner
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}
                </motion.div>
                )}

                {/* Payment Intent Creation Form - Only shown in 'create' mode */}
                {recoveryMode === 'create' && selectedUser && (
                    <motion.div
                        className="bg-surface rounded-xl p-6 border border-line mb-8"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, ease: "easeInOut" }}
                    >
                        <h2 className="text-lg sm:text-xl font-semibold text-fg mb-6">Créer une intention de paiement</h2>
                        
                        {/* Pricing Information */}
                        <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-500 rounded-lg p-4 mb-6">
                            <div className="flex items-center mb-2">
                                <DollarSign className="mr-2 text-blue-600 dark:text-blue-400" size={20} />
                                <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-100">Détails du paiement</h3>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="text-fg-muted">Montant :</span>
                                    <span className="text-fg font-semibold ml-2">
                                        {getCurrentPricing().amount} {getCurrentCurrency()}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-fg-muted">Abonnement :</span>
                                    <span className="text-fg font-semibold ml-2">
                                        {getCurrentPricing().label}
                                    </span>
                                </div>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Provider */}
                            <div>
                                <label className="block text-sm font-medium text-fg-muted mb-2">Fournisseur de paiement</label>
                                <select
                                    value={formData.provider}
                                    onChange={(e) => handleFormChange('provider', e.target.value)}
                                    className="bg-surface border border-line-strong text-fg rounded-lg px-4 py-2 w-full focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="cinetpay">CinetPay (XAF)</option>
                                    <option value="feexpay">FeexPay (XAF)</option>
                                    <option value="nowpayments">NOWPayments (USD)</option>
                                </select>
                            </div>

                            {/* Subscription Type */}
                            <div>
                                <label className="block text-sm font-medium text-fg-muted mb-2">Type d'abonnement (à vie)</label>
                                <select
                                    value={formData.subscriptionType}
                                    onChange={(e) => handleFormChange('subscriptionType', e.target.value)}
                                    className="bg-surface border border-line-strong text-fg rounded-lg px-4 py-2 w-full focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                                >
                                    {getAvailableSubscriptionOptions(selectedUser?.activeSubscriptionTypes || []).map(option => (
                                        <option 
                                            key={option.value} 
                                            value={option.value}
                                            disabled={option.disabled}
                                            className={option.disabled ? 'text-fg-subtle' : 'text-fg'}
                                        >
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                {selectedUser && getAvailableSubscriptionOptions(selectedUser.activeSubscriptionTypes || []).every(opt => opt.disabled) && (
                                    <p className="flex items-start gap-1.5 text-red-600 dark:text-red-400 text-sm mt-2">
                                        <HugeiconsIcon icon={Alert02Icon} size={16} className="mt-0.5 shrink-0" />
                                        Ce membre a déjà l'abonnement CIBLÉ et ne peut pas bénéficier d'autres abonnements.
                                    </p>
                                )}
                                {selectedUser && selectedUser.activeSubscriptionTypes?.includes(SubscriptionType.CLASSIQUE) && !selectedUser.activeSubscriptionTypes?.includes(SubscriptionType.CIBLE) && (
                                    <p className="flex items-start gap-1.5 text-yellow-700 dark:text-yellow-400 text-sm mt-2">
                                        <HugeiconsIcon icon={BulbIcon} size={16} className="mt-0.5 shrink-0" />
                                        Ce membre a l'abonnement CLASSIQUE et peut seulement faire l'UPGRADE vers CIBLÉ.
                                    </p>
                                )}
                            </div>

                            {/* External Reference */}
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-fg-muted mb-2">Référence externe</label>
                                <input
                                    type="text"
                                    value={formData.externalReference}
                                    onChange={(e) => handleFormChange('externalReference', e.target.value)}
                                    className="bg-surface border border-line-strong text-fg rounded-lg px-4 py-2 w-full focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                                    placeholder="Référence du paiement chez le fournisseur (facultatif)"
                                />
                            </div>
                        </div>

                        {/* Admin Note */}
                        <div className="mt-6">
                            <label className="block text-sm font-medium text-fg-muted mb-2">Note de l'admin</label>
                            <textarea
                                value={formData.adminNote}
                                onChange={(e) => handleFormChange('adminNote', e.target.value)}
                                className="bg-surface border border-line-strong text-fg rounded-lg px-4 py-2 w-full focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                                placeholder={`Exemple : le membre a payé via ${formData.provider} mais l'inscription a échoué. Paiement récupéré avec la référence : ${formData.externalReference || 'ABC123'}`}
                                rows={3}
                            />
                        </div>

                        {/* Checkboxes */}
                        <div className="mt-6 space-y-3">
                            <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    checked={formData.autoMarkSucceeded}
                                    onChange={(e) => handleFormChange('autoMarkSucceeded', e.target.checked)}
                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-line-strong rounded-sm"
                                />
                                <label className="ml-2 text-sm text-fg-muted">
                                    Marquer automatiquement comme réussi (recommandé)
                                </label>
                            </div>
                            
                            <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    checked={formData.triggerWebhook}
                                    onChange={(e) => handleFormChange('triggerWebhook', e.target.checked)}
                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-line-strong rounded-sm"
                                />
                                <label className="ml-2 text-sm text-fg-muted">
                                    Activer l'abonnement à vie et verser les commissions (recommandé)
                                </label>
                            </div>
                        </div>

                        {/* Create Button */}
                        <div className="mt-8">
                            <button
                                onClick={() => setConfirmAction('create')}
                                disabled={isCreating}
                                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center space-x-2 transition-colors duration-200"
                            >
                                {isCreating ? (
                                    <>
                                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                        <span>Création…</span>
                                    </>
                                ) : (
                                    <>
                                        <Plus size={20} />
                                        <span>Créer l'intention de paiement</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                )}

                {/* Results Section */}
                {creationResult && (
                    <motion.div
                        className="bg-surface rounded-xl p-6 border border-line"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, ease: "easeInOut" }}
                    >
                        <h2 className="text-lg sm:text-xl font-semibold text-fg mb-4 flex items-center">
                            <CheckCircle className="mr-2 text-green-600 dark:text-green-400" size={24} />
                            Intention de paiement créée
                        </h2>
                        
                        <div className="bg-surface-2/50 rounded-lg p-4 space-y-3">
                            <div className="flex justify-between">
                                <span className="text-fg-muted">ID de session :</span>
                                <span className="text-fg font-mono">{creationResult.data.sessionId}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-fg-muted">ID membre :</span>
                                <span className="text-fg font-mono">{creationResult.data.userId}</span>
                            </div>
                            {(creationResult.data.userName || creationResult.data.userEmail) && (
                                <>
                                    <div className="flex justify-between">
                                        <span className="text-fg-muted">Nom du membre :</span>
                                        <span className="text-fg">{creationResult.data.userName || '—'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-fg-muted">E-mail du membre :</span>
                                        <span className="text-fg">{creationResult.data.userEmail || '—'}</span>
                                    </div>
                                </>
                            )}
                            <div className="flex justify-between">
                                <span className="text-fg-muted">Montant :</span>
                                <span className="text-fg">{creationResult.data.amount} {creationResult.data.currency}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-fg-muted">Statut :</span>
                                <span className={`font-semibold ${
                                    creationResult.data.status === 'SUCCEEDED' ? 'text-green-600 dark:text-green-400' : 
                                    creationResult.data.status === 'FAILED' ? 'text-red-600 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'
                                }`}>
                                    {intentStatusLabel(creationResult.data.status)}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-fg-muted">Fournisseur :</span>
                                <span className="text-fg">{creationResult.data.gateway}</span>
                            </div>
                            {creationResult.data.gatewayPaymentId && (
                                <div className="flex justify-between">
                                    <span className="text-fg-muted">ID de paiement fournisseur :</span>
                                    <span className="text-fg font-mono">{creationResult.data.gatewayPaymentId}</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span className="text-fg-muted">Type d'abonnement :</span>
                                <span className="text-fg">{creationResult.data.subscriptionProcessing.subscriptionType}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-fg-muted">Webhook déclenché :</span>
                                <span className={creationResult.data.webhookTriggered ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                    {creationResult.data.webhookTriggered ? 'Oui' : 'Non'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-fg-muted">Traitement de l'abonnement :</span>
                                <span className={creationResult.data.subscriptionProcessing.webhookConfigured ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                    {creationResult.data.subscriptionProcessing.webhookConfigured ? 'Configuré' : 'Non configuré'}
                                </span>
                            </div>
                        </div>
                        
                        <div className="mt-4">
                            <button
                                onClick={() => setCreationResult(null)}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                Créer une autre
                            </button>
                        </div>
                    </motion.div>
                )}
            </main>
            <ConfirmationModal
                isOpen={confirmAction !== null}
                variant="success"
                title={confirmAction === 'recover' ? 'Récupérer ce paiement ?' : 'Créer ce paiement ?'}
                message={
                    <div className="space-y-1 text-sm">
                        {confirmAction === 'create' && selectedUser && (
                            <>
                                <p><span className="text-fg-muted">Membre :</span> {selectedUser.name}</p>
                                <p><span className="text-fg-muted">Abonnement :</span> {formData.subscriptionType}</p>
                            </>
                        )}
                        {confirmAction === 'recover' && foundPaymentIntent && (
                            <p><span className="text-fg-muted">Paiement :</span> {foundPaymentIntent.sessionId}</p>
                        )}
                        <p className="pt-2 text-fg-muted">Le membre reçoit un abonnement à vie et les commissions sont versées aux parrains. Fais-le seulement si le paiement a bien été reçu.</p>
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