import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, Plus, DollarSign, CheckCircle, AlertCircle } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import toast from 'react-hot-toast';
import { 
    createManualPaymentIntent, 
    searchUsersForFeexPayFix, 
    ManualPaymentIntentRequest,
    ManualPaymentIntentResponse 
} from '../services/adminPaymentApi';
import { AdminUserData } from '../services/adminUserApi';
import { getAvatarUrl } from '../api/apiClient';

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
                CLASSIQUE: { amount: 2070, label: 'Classique (2,070 XAF)' },
                CIBLE: { amount: 5140, label: 'Ciblé (5,140 XAF)' },
                UPGRADE: { amount: 3070, label: 'Mise à niveau (3,070 XAF)' }
            }
        },
        feexpay: {
            currency: 'XAF',
            plans: {
                CLASSIQUE: { amount: 2070, label: 'Classique (2,070 XAF)' },
                CIBLE: { amount: 5140, label: 'Ciblé (5,140 XAF)' },
                UPGRADE: { amount: 3070, label: 'Mise à niveau (3,070 XAF)' }
            }
        },
        nowpayments: {
            currency: 'USD',
            plans: {
                CLASSIQUE: { amount: 4, label: 'Classique ($4 USD)' },
                CIBLE: { amount: 10, label: 'Ciblé ($10 USD)' },
                UPGRADE: { amount: 6, label: 'Mise à niveau ($6 USD)' }
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
            toast.error("Échec de recherche des utilisateurs.");
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
        const toastId = toast.loading('Recherche d\'intention de paiement...');

        try {
            const { searchPaymentIntent } = await import('../services/adminPaymentApi');
            const result = await searchPaymentIntent(searchReference.trim());

            if (result.success && result.data) {
                setFoundPaymentIntent(result.data);
                toast.success('Intention de paiement trouvée!', { id: toastId });
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
        const toastId = toast.loading('Récupération de l\'intention de paiement...');

        try {
            const { recoverExistingPaymentIntent } = await import('../services/adminPaymentApi');
            const result = await recoverExistingPaymentIntent(
                foundPaymentIntent.sessionId,
                `Récupération admin - Référence: ${searchReference}`
            );

            setCreationResult(result);
            toast.success('Intention de paiement récupérée avec succès!', { id: toastId });
            
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

    const handleCreatePaymentIntent = async () => {
        if (!selectedUser) {
            toast.error('Veuillez sélectionner un utilisateur d\'abord');
            return;
        }

        const pricing = getCurrentPricing();
        setIsCreating(true);
        const toastId = toast.loading('Création de l\'intention de paiement manuelle...');

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
            
            toast.success('Intention de paiement créée avec succès!', { id: toastId });
            
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
        <div className="flex-1 overflow-auto relative z-10">
            <Header title="Récupération de Paiement Manuelle" />
            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">

                {/* Recovery Mode Toggle */}
                <motion.div
                    className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-8"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1, ease: "easeInOut" }}
                >
                    <h2 className="text-lg sm:text-xl font-semibold text-gray-100 mb-4">Mode de Récupération</h2>
                    
                    <div className="flex space-x-4">
                        <button
                            onClick={() => setRecoveryMode('create')}
                            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                                recoveryMode === 'create' 
                                    ? 'bg-blue-600 text-white' 
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            📝 Créer Nouvelle Intention
                        </button>
                        <button
                            onClick={() => setRecoveryMode('find')}
                            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                                recoveryMode === 'find' 
                                    ? 'bg-green-600 text-white' 
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            🔍 Récupérer Intention Existante
                        </button>
                    </div>
                    
                    <p className="text-gray-400 text-sm mt-3">
                        {recoveryMode === 'create' 
                            ? 'Créer une nouvelle intention de paiement pour un utilisateur'
                            : 'Chercher et récupérer une intention de paiement existante par Session ID ou référence de paiement'
                        }
                    </p>
                </motion.div>

                {/* Payment Intent Search Section - Only shown in 'find' mode */}
                {recoveryMode === 'find' && (
                    <motion.div
                        className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-8"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, ease: "easeInOut" }}
                    >
                        <h2 className="text-lg sm:text-xl font-semibold text-gray-100 mb-4">
                            🔍 Rechercher Intention de Paiement
                        </h2>
                        
                        <div className="flex gap-4 mb-6">
                            <div className="flex-1">
                                <input
                                    type="text"
                                    placeholder="Session ID ou Gateway Payment ID..."
                                    className="bg-gray-700 text-white placeholder-gray-400 rounded-lg px-4 py-2 w-full focus:outline-none focus:ring-2 focus:ring-green-500"
                                    value={searchReference}
                                    onChange={(e) => setSearchReference(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleSearchPaymentIntent()}
                                />
                            </div>
                            <button
                                onClick={handleSearchPaymentIntent}
                                disabled={isSearching || !searchReference.trim()}
                                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-6 py-2 rounded-lg flex items-center space-x-2 transition-colors"
                            >
                                {isSearching ? (
                                    <>
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                        <span>Recherche...</span>
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
                            <div className="bg-gray-700 bg-opacity-50 rounded-lg p-4 mb-4">
                                <h3 className="text-lg font-semibold text-gray-100 mb-3 flex items-center">
                                    <CheckCircle className="mr-2 text-green-400" size={20} />
                                    Intention de Paiement Trouvée
                                </h3>
                                
                                <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                                    <div>
                                        <span className="text-gray-400">Session ID:</span>
                                        <span className="text-white font-mono ml-2">{foundPaymentIntent.sessionId}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Statut:</span>
                                        <span className={`ml-2 font-semibold ${
                                            foundPaymentIntent.status === 'SUCCEEDED' ? 'text-green-400' : 
                                            foundPaymentIntent.status === 'FAILED' ? 'text-red-400' : 'text-yellow-400'
                                        }`}>
                                            {foundPaymentIntent.status}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Montant:</span>
                                        <span className="text-white ml-2">{foundPaymentIntent.amount} {foundPaymentIntent.currency}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Gateway:</span>
                                        <span className="text-white ml-2">{foundPaymentIntent.gateway}</span>
                                    </div>
                                    {foundPaymentIntent.gatewayPaymentId && (
                                        <div>
                                            <span className="text-gray-400">Gateway Payment ID:</span>
                                            <span className="text-white font-mono ml-2">{foundPaymentIntent.gatewayPaymentId}</span>
                                        </div>
                                    )}
                                    <div>
                                        <span className="text-gray-400">Nom de l'utilisateur:</span>
                                        <span className="text-white ml-2">{foundPaymentIntent.userName || 'N/A'}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Email de l'utilisateur:</span>
                                        <span className="text-white ml-2">{foundPaymentIntent.userEmail || 'N/A'}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">User ID:</span>
                                        <span className="text-white font-mono ml-2">{foundPaymentIntent.userId}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Créé le:</span>
                                        <span className="text-white ml-2">{new Date(foundPaymentIntent.createdAt).toLocaleString('fr-FR')}</span>
                                    </div>
                                </div>

                                {foundPaymentIntent.canRecover ? (
                                    <div className="flex items-center justify-between">
                                        <span className="text-green-400 text-sm">✅ Cette intention peut être récupérée</span>
                                        <button
                                            onClick={handleRecoverPaymentIntent}
                                            disabled={isCreating}
                                            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors"
                                        >
                                            {isCreating ? (
                                                <>
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                                    <span>Récupération...</span>
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
                                    <div className="text-red-400 text-sm">❌ Cette intention ne peut pas être récupérée (déjà réussie)</div>
                                )}
                            </div>
                        )}
                    </motion.div>
                )}
                
                {/* User Search Section - Only shown in 'create' mode */}
                {recoveryMode === 'create' && (
                <motion.div
                    className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-8"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1, ease: "easeInOut" }}
                >
                    <h2 className="text-lg sm:text-xl font-semibold text-gray-100 mb-4">
                        {selectedUser ? `Utilisateur sélectionné: ${selectedUser.name}` : 'Rechercher Utilisateur'}
                    </h2>
                    
                    {selectedUser ? (
                        <div className="flex items-center justify-between bg-gray-700 bg-opacity-50 rounded-lg p-4">
                            <div className="flex items-center space-x-4">
                                <img
                                    src={getAvatarUrl(selectedUser.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedUser.name || 'User')}&background=random`}
                                    alt={`${selectedUser.name}'s avatar`}
                                    className="h-12 w-12 rounded-full object-cover"
                                />
                                <div>
                                    <p className="text-white font-medium">{selectedUser.name}</p>
                                    <p className="text-gray-400 text-sm">{selectedUser.email}</p>
                                    <p className="text-gray-400 text-sm">{selectedUser.phoneNumber || 'Aucun téléphone'}</p>
                                </div>
                            </div>
                            <button
                                onClick={resetForm}
                                className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                Changer Utilisateur
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="relative w-full mb-6">
                                <input
                                    type="text"
                                    placeholder="Rechercher par nom, email, ou numéro de téléphone..."
                                    className="bg-gray-700 text-white placeholder-gray-400 rounded-lg pl-10 pr-4 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    value={searchTerm}
                                    onChange={handleSearchChange}
                                />
                                <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
                            </div>

                            {loadingUsers ? (
                                <div className="text-center py-4"><Loader name="Users" /></div>
                            ) : users.length === 0 && searchTerm !== '' ? (
                                <p className="text-center text-gray-400">No users found matching "{searchTerm}".</p>
                            ) : users.length === 0 && searchTerm === '' ? (
                                <p className="text-center text-gray-400">Start typing to search for users.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-700">
                                        <thead>
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Avatar</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Email</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Phone</th>
                                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-700">
                                            {users.map((user) => (
                                                <tr key={user._id}>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">
                                                        <img
                                                            src={getAvatarUrl(user.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'User')}&background=random`}
                                                            alt={`${user.name}'s avatar`}
                                                            className="h-10 w-10 rounded-full object-cover"
                                                        />
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">{user.name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">{user.email || 'N/A'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">{user.phoneNumber || 'N/A'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                                                        <button
                                                            onClick={() => handleUserSelect(user)}
                                                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200"
                                                        >
                                                            Select User
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
                        className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-8"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, ease: "easeInOut" }}
                    >
                        <h2 className="text-lg sm:text-xl font-semibold text-gray-100 mb-6">Créer Intention de Paiement</h2>
                        
                        {/* Pricing Information */}
                        <div className="bg-blue-900 bg-opacity-30 border border-blue-500 rounded-lg p-4 mb-6">
                            <div className="flex items-center mb-2">
                                <DollarSign className="mr-2 text-blue-400" size={20} />
                                <h3 className="text-lg font-semibold text-blue-100">Détails du Paiement</h3>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="text-gray-400">Montant:</span>
                                    <span className="text-white font-semibold ml-2">
                                        {getCurrentPricing().amount} {getCurrentCurrency()}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-gray-400">Abonnement:</span>
                                    <span className="text-white font-semibold ml-2">
                                        {getCurrentPricing().label}
                                    </span>
                                </div>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Provider */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Payment Provider</label>
                                <select
                                    value={formData.provider}
                                    onChange={(e) => handleFormChange('provider', e.target.value)}
                                    className="bg-gray-700 text-white rounded-lg px-4 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="cinetpay">CinetPay (XAF)</option>
                                    <option value="feexpay">FeexPay (XAF)</option>
                                    <option value="nowpayments">NOWPayments (USD)</option>
                                </select>
                            </div>

                            {/* Subscription Type */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Subscription Type (Lifetime)</label>
                                <select
                                    value={formData.subscriptionType}
                                    onChange={(e) => handleFormChange('subscriptionType', e.target.value)}
                                    className="bg-gray-700 text-white rounded-lg px-4 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="CLASSIQUE">Classique - Basic country targeting (Lifetime)</option>
                                    <option value="CIBLE">Ciblé - Advanced targeting all criteria (Lifetime)</option>
                                    <option value="UPGRADE">Upgrade - From Classique to Ciblé (Lifetime)</option>
                                </select>
                            </div>

                            {/* External Reference */}
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-gray-300 mb-2">External Reference</label>
                                <input
                                    type="text"
                                    value={formData.externalReference}
                                    onChange={(e) => handleFormChange('externalReference', e.target.value)}
                                    className="bg-gray-700 text-white rounded-lg px-4 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Original payment reference from provider (optional)"
                                />
                            </div>
                        </div>

                        {/* Admin Note */}
                        <div className="mt-6">
                            <label className="block text-sm font-medium text-gray-300 mb-2">Admin Note</label>
                            <textarea
                                value={formData.adminNote}
                                onChange={(e) => handleFormChange('adminNote', e.target.value)}
                                className="bg-gray-700 text-white rounded-lg px-4 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder={`Example: User paid via ${formData.provider} but registration failed. Recovered payment with reference: ${formData.externalReference || 'ABC123'}`}
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
                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                />
                                <label className="ml-2 text-sm text-gray-300">
                                    Auto-mark as succeeded (recommended)
                                </label>
                            </div>
                            
                            <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    checked={formData.triggerWebhook}
                                    onChange={(e) => handleFormChange('triggerWebhook', e.target.checked)}
                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                />
                                <label className="ml-2 text-sm text-gray-300">
                                    Activate lifetime subscription & process commissions (recommended)
                                </label>
                            </div>
                        </div>

                        {/* Create Button */}
                        <div className="mt-8">
                            <button
                                onClick={handleCreatePaymentIntent}
                                disabled={isCreating}
                                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center space-x-2 transition-colors duration-200"
                            >
                                {isCreating ? (
                                    <>
                                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                        <span>Creating...</span>
                                    </>
                                ) : (
                                    <>
                                        <Plus size={20} />
                                        <span>Create Payment Intent</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                )}

                {/* Results Section */}
                {creationResult && (
                    <motion.div
                        className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, ease: "easeInOut" }}
                    >
                        <h2 className="text-lg sm:text-xl font-semibold text-gray-100 mb-4 flex items-center">
                            <CheckCircle className="mr-2 text-green-400" size={24} />
                            Payment Intent Created Successfully
                        </h2>
                        
                        <div className="bg-gray-700 bg-opacity-50 rounded-lg p-4 space-y-3">
                            <div className="flex justify-between">
                                <span className="text-gray-400">Session ID:</span>
                                <span className="text-white font-mono">{creationResult.data.sessionId}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">User ID:</span>
                                <span className="text-white font-mono">{creationResult.data.userId}</span>
                            </div>
                            {selectedUser && (
                                <>
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Nom de l'utilisateur:</span>
                                        <span className="text-white">{selectedUser.name}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Email de l'utilisateur:</span>
                                        <span className="text-white">{selectedUser.email}</span>
                                    </div>
                                </>
                            )}
                            <div className="flex justify-between">
                                <span className="text-gray-400">Montant:</span>
                                <span className="text-white">{creationResult.data.amount} {creationResult.data.currency}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Statut:</span>
                                <span className={`font-semibold ${
                                    creationResult.data.status === 'SUCCEEDED' ? 'text-green-400' : 
                                    creationResult.data.status === 'FAILED' ? 'text-red-400' : 'text-yellow-400'
                                }`}>
                                    {creationResult.data.status}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Gateway:</span>
                                <span className="text-white">{creationResult.data.gateway}</span>
                            </div>
                            {creationResult.data.gatewayPaymentId && (
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Gateway Payment ID:</span>
                                    <span className="text-white font-mono">{creationResult.data.gatewayPaymentId}</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span className="text-gray-400">Type d'Abonnement:</span>
                                <span className="text-white">{creationResult.data.subscriptionProcessing.subscriptionType}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Webhook Déclenché:</span>
                                <span className={creationResult.data.webhookTriggered ? 'text-green-400' : 'text-red-400'}>
                                    {creationResult.data.webhookTriggered ? 'Oui' : 'Non'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Traitement Abonnement:</span>
                                <span className={creationResult.data.subscriptionProcessing.webhookConfigured ? 'text-green-400' : 'text-red-400'}>
                                    {creationResult.data.subscriptionProcessing.webhookConfigured ? 'Configuré' : 'Non Configuré'}
                                </span>
                            </div>
                        </div>
                        
                        <div className="mt-4">
                            <button
                                onClick={() => setCreationResult(null)}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                Create Another
                            </button>
                        </div>
                    </motion.div>
                )}
            </main>
        </div>
    );
}

export default ManualPaymentRecoveryPage;