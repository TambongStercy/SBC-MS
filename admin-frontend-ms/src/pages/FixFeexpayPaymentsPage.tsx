import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, Hammer } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import toast from 'react-hot-toast';
import { reprocessFeexpayPaymentsForUser, searchUsersForFeexPayFix, ReprocessFeexpayResult } from '../services/adminPaymentApi';
import { AdminUserData } from '../services/adminUserApi'; // Reusing the AdminUserData interface
import { getAvatarUrl } from '../api/apiClient'; // Import getAvatarUrl

function FixFeexpayPaymentsPage() {
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
            toast.error("Failed to search users.");
            console.error("Failed to search users:", error);
        } finally {
            setLoadingUsers(false);
        }
    }, []);

    const handleReprocessPayments = useCallback(async (userId: string) => {
        setReprocessingUserId(userId); // Set the user being reprocessed
        setReprocessingResults(prev => ({ ...prev, [userId]: [] })); // Clear previous results for this user
        toast.loading('Initiating payment fix... This might take up to 5 minutes.', { duration: 300000 }); // 5 minutes duration

        try {
            const results = await reprocessFeexpayPaymentsForUser(userId);
            setReprocessingResults(prev => ({ ...prev, [userId]: results }));
            toast.success('Payment fix initiated. Check results.');
        } catch (error) {
            toast.error("Failed to initiate payment fix.");
            console.error("Error during reprocessing:", error);
            setReprocessingResults(prev => ({ ...prev, [userId]: [{ sessionId: '', status: '', message: 'Failed to reprocess.' }] }));
        } finally {
            setReprocessingUserId(null); // Reset after completion
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
        <div className="flex-1 overflow-auto relative z-10">
            <Header title="Fix FeexPay Payments" />
            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                <motion.div
                    className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-8"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1, ease: "easeInOut" }}
                >
                    <h2 className="text-lg sm:text-xl font-semibold text-gray-100 mb-4">Search Users</h2>
                    <div className="relative w-full mb-6">
                        <input
                            type="text"
                            placeholder="Search by name, email, or phone number..."
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
                                                    onClick={() => handleReprocessPayments(user._id)}
                                                    disabled={reprocessingUserId === user._id}
                                                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                                                >
                                                    {reprocessingUserId === user._id ? (
                                                        <><Hammer size={16} className="animate-spin mr-2" /> Fixing...</>
                                                    ) : (
                                                        <><Hammer size={16} className="mr-2" /> Fix FeexPay Payments</>
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
                        className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mt-8"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, ease: "easeInOut" }}
                    >
                        <h2 className="text-lg sm:text-xl font-semibold text-gray-100 mb-4">Reprocessing Results</h2>
                        {Object.entries(reprocessingResults).map(([userId, results]) => (
                            <div key={userId} className="mb-6 p-4 border border-gray-700 rounded-lg">
                                <h3 className="text-md font-medium text-gray-100 mb-2">Results for User ID: {userId}</h3>
                                <ul className="list-disc list-inside text-gray-300">
                                    {results.map((result, index) => (
                                        <li key={index} className="mb-1">
                                            <span className="font-semibold">Session ID:</span> {result.sessionId} -
                                            <span className={`font-semibold ${result.status === 'SUCCEEDED' ? 'text-green-400' : result.status === 'FAILED' ? 'text-red-400' : 'text-yellow-400'}`}>Status: {result.status}</span> -
                                            Message: {result.message}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </motion.div>
                )}
            </main>
        </div>
    );
}

export default FixFeexpayPaymentsPage; 