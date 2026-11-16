import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, Hammer } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import toast from 'react-hot-toast';
import { reprocessFeexpayPaymentsForUser, searchUsersForFeexPayFix, ReprocessFeexpayResult } from '../services/adminPaymentApi';
import { AdminUserData } from '../services/adminUserApi'; // Reusing the AdminUserData interface
import { getAvatarUrl } from '../api/apiClient'; // Import getAvatarUrl

const RESULT_STATUS_LABELS: Record<string, string> = { SUCCEEDED: 'Réussi', FAILED: 'Échoué', PENDING: 'En attente', PROCESSING: 'En cours' };

interface FixFeexpayPaymentsPageProps {
    embedded?: boolean; // Suppress <Header /> when rendered inside the unified /fix-provider-issues tabbed page.
}

function FixFeexpayPaymentsPage({ embedded = false }: FixFeexpayPaymentsPageProps = {}) {
    const [searchTerm, setSearchTerm] = useState('');
    const [users, setUsers] = useState<AdminUserData[]>([]);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [reprocessingUserId, setReprocessingUserId] = useState<string | null>(null);
    const [reprocessingResults, setReprocessingResults] = useState<Record<string, ReprocessFeexpayResult[]>>({});
    const [debounceTimeout, setDebounceTimeout] = useState<NodeJS.Timeout | null>(null);

    // Debounce search input
    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(event.target.value);
        if (debounceTimeout) {
            clearTimeout(debounceTimeout);
        }
        const timeout = setTimeout(() => {
            if (event.target.value.trim() !== '') {
                fetchUsers(event.target.value);
            } else {
                setUsers([]); // Clear users when search box is empty
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
            console.error("Failed to search users:", error);
        } finally {
            setLoadingUsers(false);
        }
    }, []);

    const handleReprocessPayments = useCallback(async (userId: string) => {
        setReprocessingUserId(userId); // Set the user being reprocessed
        setReprocessingResults(prev => ({ ...prev, [userId]: [] })); // Clear previous results for this user
        const toastId = toast.loading('Correction des paiements en cours… Cela peut prendre jusqu\'à 5 minutes.', { duration: 300000 }); // 5 minutes duration

        try {
            const results = await reprocessFeexpayPaymentsForUser(userId);
            setReprocessingResults(prev => ({ ...prev, [userId]: results }));
            toast.success('Correction lancée. Consultez les résultats.', { id: toastId }); // Dismiss and show success
        } catch (error) {
            console.error("Error during reprocessing:", error);
            toast.error("Impossible de lancer la correction.", { id: toastId }); // Dismiss and show error
            setReprocessingResults(prev => ({ ...prev, [userId]: [{ sessionId: '', status: '', message: 'Le retraitement a échoué.' }] }));
        } finally {
            setReprocessingUserId(null); // Reset after completion
            toast.dismiss(toastId); // Ensure the loading toast is always dismissed
        }
    }, []);

    // Initial fetch for popular/recent users or clear users if no search term
    useEffect(() => {
        // On initial load, if there's no search term, ensure users list is empty.
        // If you want to show initial users, call fetchUsers with a default query or empty string
        // if (searchTerm === '') { 
        //     setUsers([]);
        // } else {
        //     fetchUsers(searchTerm);
        // }
    }, []);

    return (
        <div>
            {!embedded && <Header title="Paiements FeexPay à corriger" />}
            <main>
                <motion.div
                    className="bg-surface rounded-xl p-6 border border-line mb-8"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1, ease: "easeInOut" }}
                >
                    <h2 className="text-lg sm:text-xl font-semibold text-fg mb-4">Rechercher un membre</h2>
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
                                                    onClick={() => handleReprocessPayments(user._id)}
                                                    disabled={reprocessingUserId === user._id}
                                                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                                                >
                                                    {reprocessingUserId === user._id ? (
                                                        <><Hammer size={16} className="animate-spin mr-2" /> Correction…</>
                                                    ) : (
                                                        <><Hammer size={16} className="mr-2" /> Corriger les paiements FeexPay</>
                                                    )}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </motion.div>

                {Object.keys(reprocessingResults).length > 0 && (
                    <motion.div
                        className="bg-surface rounded-xl p-6 border border-line mt-8"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, ease: "easeInOut" }}
                    >
                        <h2 className="text-lg sm:text-xl font-semibold text-fg mb-4">Résultats du retraitement</h2>
                        {Object.entries(reprocessingResults).map(([userId, results]) => (
                            <div key={userId} className="mb-6 p-4 border border-line rounded-lg">
                                <h3 className="text-md font-medium text-fg mb-2">Résultats pour le membre {userId}</h3>
                                {results.length === 0 ? (
                                    <p className="text-fg-muted">Aucune erreur à corriger pour ce membre.</p>
                                ) : (
                                    <ul className="list-disc list-inside text-fg-muted">
                                        {results.map((result, index) => (
                                            <li key={index} className="mb-1">
                                                <span className="font-semibold">ID de session :</span> {result.sessionId} -
                                                <span className={`font-semibold ${result.status === 'SUCCEEDED' ? 'text-green-600 dark:text-green-400' : result.status === 'FAILED' ? 'text-red-600 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'}`}>Statut : {RESULT_STATUS_LABELS[result.status] ?? result.status}</span> -
                                                Message : {result.message}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </motion.div>
                )}
            </main>
        </div>
    );
}

export default FixFeexpayPaymentsPage; 