import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Send, AlertTriangle, Search, UserPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import WhatsAppManager from '../components/WhatsAppManager';
// TODO: Import necessary API functions (searchUsers, sendBulkNotification, sendCriteriaNotification)
// import { searchUsers } from '../services/adminUserApi'; // Example
// import { sendBulkNotification, sendCriteriaNotification } from '../services/adminNotificationApi'; // Example

// Mock API functions for now (replace later)
const searchUsers = async (searchTerm: string): Promise<UserOption[]> => {
    console.warn('Using mock searchUsers API with term:', searchTerm);
    await new Promise(resolve => setTimeout(resolve, 500));
    const allUsers = [
        { id: 'user1', name: 'Alice Admin', email: 'alice@example.com' },
        { id: 'user2', name: 'Bob User', email: 'bob@example.com' },
        { id: 'user3', name: 'Charlie Client', email: 'charlie@example.com' },
        { id: 'user4', name: 'David Developer', email: 'david@example.com' },
        { id: 'user5', name: 'Eve Engineer', email: 'eve@example.com' },
    ];
    if (!searchTerm) return [];
    return allUsers.filter(u =>
        u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(searchTerm.toLowerCase())
    );
};

const sendBulkNotification = async (data: { userIds: string[]; subject: string; body: string }): Promise<void> => {
    console.warn('Using mock sendBulkNotification API with data:', data);
    await new Promise(resolve => setTimeout(resolve, 1500));
    console.log('Mock bulk notification sent successfully');
};

const sendCriteriaNotification = async (data: { criteria: any; subject: string; body: string }): Promise<void> => {
    console.warn('Using mock sendCriteriaNotification API with data:', data);
    await new Promise(resolve => setTimeout(resolve, 1500));
    console.log('Mock criteria notification sent successfully');
};

// End Mock API functions

interface UserOption {
    id: string;
    name: string;
    email: string;
}

// Define structure for criteria-based filtering
interface NotificationCriteria {
    role?: string;
    status?: string;
    registrationDateFrom?: string;
    registrationDateTo?: string;
    subscriptionPlanId?: string;
    subscriptionStatus?: string;
}

// Mock Subscription Plan type (replace with actual type later)
interface SubscriptionPlan {
    _id: string;
    name: string;
    // Add other relevant plan fields if needed
}

// Mock function to fetch subscription plans
const getSubscriptionPlans = async (): Promise<SubscriptionPlan[]> => {
    console.warn('Using mock getSubscriptionPlans API');
    await new Promise(resolve => setTimeout(resolve, 800));
    return [
        { _id: 'plan1', name: 'Basic Plan' },
        { _id: 'plan2', name: 'Pro Plan' },
        { _id: 'plan3', name: 'Enterprise Plan' },
    ];
};

type SendMode = 'manual' | 'criteria';

const NotificationsPage: React.FC = () => {
    // Send Mode
    const [sendMode, setSendMode] = useState<SendMode>('manual');

    // Manual Selection State
    const [manualSearchTerm, setManualSearchTerm] = useState('');
    const [suggestedUsers, setSuggestedUsers] = useState<UserOption[]>([]);
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
    const [selectedUsers, setSelectedUsers] = useState<UserOption[]>([]);

    // Criteria Selection State
    const [criteria, setCriteria] = useState<NotificationCriteria>({});
    const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
    const [isLoadingPlans, setIsLoadingPlans] = useState(false);

    // Common State
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // --- Handlers ---

    const handleSearchUsers = useCallback(async () => {
        if (!manualSearchTerm.trim()) {
            setSuggestedUsers([]);
            return;
        }
        setIsLoadingSuggestions(true);
        setError(null);
        try {
            const results = await searchUsers(manualSearchTerm.trim());
            const newSuggestions = results.filter(
                suggested => !selectedUsers.some(selected => selected.id === suggested.id)
            );
            setSuggestedUsers(newSuggestions);
        } catch (err: any) {
            console.error('Failed to search users:', err);
            const errMsg = err.message || 'Failed to search users.';
            setError(errMsg);
            toast.error(errMsg);
        } finally {
            setIsLoadingSuggestions(false);
        }
    }, [manualSearchTerm, selectedUsers]);

    useEffect(() => {
        if (sendMode === 'manual' && !manualSearchTerm) {
            setSuggestedUsers([]);
        }
    }, [manualSearchTerm, sendMode]);

    const handleAddUser = (user: UserOption) => {
        if (!selectedUsers.some(u => u.id === user.id)) {
            setSelectedUsers(prev => [...prev, user]);
            setSuggestedUsers(prev => prev.filter(u => u.id !== user.id)); // Remove from suggestions
        }
    };

    const handleRemoveUser = (userId: string) => {
        setSelectedUsers(prev => prev.filter(u => u.id !== userId));
        // Optional: Add back to suggestions if it matches current search term?
        // For simplicity, we don't add back automatically here.
    };

    // Fetch subscription plans when criteria mode is selected or on mount
    useEffect(() => {
        // Fetch only if in criteria mode or if plans haven't been loaded yet
        // if (sendMode === 'criteria' && subscriptionPlans.length === 0) {
        // Let's load them once on mount for simplicity for now
        if (subscriptionPlans.length === 0) {
            const fetchPlans = async () => {
                setIsLoadingPlans(true);
                try {
                    // TODO: Replace with actual API call
                    const plans = await getSubscriptionPlans();
                    setSubscriptionPlans(plans);
                } catch (err) {
                    console.error('Failed to fetch subscription plans:', err);
                    toast.error('Failed to load subscription plans.');
                    // Handle error appropriately, maybe disable the dropdown
                } finally {
                    setIsLoadingPlans(false);
                }
            };
            fetchPlans();
        }
        // }, [sendMode, subscriptionPlans.length]); // Original dependency
    }, [subscriptionPlans.length]); // Simplified dependency

    const handleCriteriaChange = (event: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
        const { name, value } = event.target;
        setCriteria(prev => {
            const updatedCriteria = { ...prev, [name]: value };
            // Clear value if it's empty (e.g., selecting default "-- All --")
            if (value === '') {
                delete updatedCriteria[name as keyof NotificationCriteria];
            }
            return updatedCriteria;
        });
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);

        if (!subject.trim()) {
            toast.error('Subject cannot be empty.');
            return;
        }
        if (!body.trim()) {
            toast.error('Body cannot be empty.');
            return;
        }

        setIsSending(true);
        const toastId = toast.loading('Sending notification(s)...');

        try {
            if (sendMode === 'manual') {
                if (selectedUsers.length === 0) {
                    toast.error('Please select at least one user.', { id: toastId });
                    setIsSending(false);
                    return;
                }
                // TODO: Replace with actual API call
                await sendBulkNotification({
                    userIds: selectedUsers.map(u => u.id),
                    subject: subject.trim(),
                    body: body.trim(),
                });
                toast.success(`Notification sent to ${selectedUsers.length} user(s).`, { id: toastId });
                // Clear manual form
                setSelectedUsers([]);
                setManualSearchTerm('');
                setSuggestedUsers([]);

            } else { // Criteria mode
                // TODO: Implement criteria validation
                if (Object.keys(criteria).length === 0) { // Basic check
                    toast.error('Please define notification criteria.', { id: toastId });
                    setIsSending(false);
                    return;
                }
                // TODO: Replace with actual API call
                await sendCriteriaNotification({
                    criteria, // Send the criteria object
                    subject: subject.trim(),
                    body: body.trim(),
                });
                toast.success(`Notification queued based on criteria.`, { id: toastId });
                // Clear criteria form
                setCriteria({});
                // TODO: Reset criteria UI elements
            }

            // Clear common fields
            setSubject('');
            setBody('');

        } catch (err: any) {
            console.error('Failed to send notification:', err);
            const errMsg = err.message || 'Failed to send notification(s).';
            setError(errMsg);
            toast.error(errMsg, { id: toastId });
        } finally {
            setIsSending(false);
        }
    };

    // --- Render ---

    return (
        <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white p-4 md:p-8">
            <h1 className="text-2xl md:text-3xl font-bold mb-6 text-white">Notifications Management</h1>

            {/* WhatsApp Management Section */}
            <div className="max-w-4xl mx-auto mb-8">
                <WhatsAppManager />
            </div>

            {/* Notification Sending Section */}
            <div className="max-w-3xl mx-auto bg-gray-800 shadow rounded-lg p-6">
                <h2 className="text-xl font-semibold text-white mb-6">Send Notification</h2>
                <form onSubmit={handleSubmit} className="space-y-6">

                    {/* Send Mode Selection */}
                    <fieldset className="mb-6">
                        <legend className="text-lg font-medium text-gray-200 mb-2">Recipient Selection Mode</legend>
                        <div className="flex gap-x-4">
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="sendMode"
                                    value="manual"
                                    checked={sendMode === 'manual'}
                                    onChange={() => setSendMode('manual')}
                                    className="form-radio h-4 w-4 text-indigo-600 bg-gray-700 border-gray-600 focus:ring-indigo-500"
                                    disabled={isSending}
                                />
                                <span className="text-sm text-gray-300">Manual User Selection</span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="sendMode"
                                    value="criteria"
                                    checked={sendMode === 'criteria'}
                                    onChange={() => setSendMode('criteria')}
                                    className="form-radio h-4 w-4 text-indigo-600 bg-gray-700 border-gray-600 focus:ring-indigo-500"
                                    disabled={isSending}
                                />
                                <span className="text-sm text-gray-300">Criteria-Based Selection</span>
                            </label>
                        </div>
                    </fieldset>

                    {/* --- Manual Selection Section --- */}
                    {sendMode === 'manual' && (
                        <div className="space-y-4 p-4 border border-gray-700 rounded-md">
                            <h2 className="text-md font-medium text-gray-300 mb-2">Select Users Manually</h2>
                            {/* User Search Input */}
                            <div>
                                <label htmlFor="manualSearch" className="block text-sm font-medium text-gray-300 mb-1">
                                    Search Users (Name or Email)
                                </label>
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="text"
                                        id="manualSearch"
                                        value={manualSearchTerm}
                                        onChange={(e) => setManualSearchTerm(e.target.value)}
                                        disabled={isSending}
                                        className="flex-grow px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white placeholder-gray-400 disabled:opacity-50"
                                        placeholder="Enter name or email and click Search"
                                        onKeyDown={(e) => { if (e.key === 'Enter' && manualSearchTerm.trim()) { e.preventDefault(); handleSearchUsers(); } }}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleSearchUsers}
                                        disabled={isSending || isLoadingSuggestions || !manualSearchTerm.trim()}
                                        className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                                    >
                                        {isLoadingSuggestions ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Search className="h-4 w-4" />
                                        )}
                                        <span className="ml-2">Search</span>
                                    </button>
                                </div>
                            </div>

                            {/* Search Suggestions */}
                            {suggestedUsers.length > 0 && !isLoadingSuggestions && (
                                <ul className="border border-gray-600 rounded-md max-h-40 overflow-y-auto bg-gray-700">
                                    {suggestedUsers.map((user) => (
                                        <li key={user.id} className="flex items-center justify-between px-3 py-2 border-b border-gray-600 last:border-b-0">
                                            <span className="text-sm text-gray-200">{user.name} ({user.email})</span>
                                            <button
                                                type="button"
                                                onClick={() => handleAddUser(user)}
                                                className="p-1 rounded text-indigo-400 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                                title="Add User"
                                            >
                                                <UserPlus className="h-4 w-4" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {/* Selected Users */}
                            {selectedUsers.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-300 mb-2">Selected Users ({selectedUsers.length}):</h3>
                                    <ul className="space-y-1 max-h-48 overflow-y-auto border border-gray-600 rounded-md p-2 bg-gray-750">
                                        {selectedUsers.map((user) => (
                                            <li key={user.id} className="flex items-center justify-between bg-gray-700 p-1.5 rounded text-sm">
                                                <span className="text-gray-200">{user.name} ({user.email})</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveUser(user.id)}
                                                    className="p-0.5 rounded text-red-400 hover:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-red-500"
                                                    title="Remove User"
                                                    disabled={isSending}
                                                >
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    {/* --- Criteria Selection Section --- */}
                    {sendMode === 'criteria' && (
                        <div className="space-y-4 p-4 border border-gray-700 rounded-md">
                            <h2 className="text-md font-medium text-gray-300 mb-3">Define Notification Criteria</h2>

                            {/* Role Dropdown */}
                            <div>
                                <label htmlFor="role" className="block text-sm font-medium text-gray-300 mb-1">
                                    User Role
                                </label>
                                <select
                                    id="role"
                                    name="role"
                                    value={criteria.role || ''}
                                    onChange={handleCriteriaChange}
                                    disabled={isSending}
                                    className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white disabled:opacity-50"
                                >
                                    <option value="">-- All Roles --</option>
                                    <option value="admin">Admin</option>
                                    <option value="user">User</option>
                                    <option value="client">Client</option> { /* Example roles */}
                                    {/* TODO: Potentially fetch roles dynamically */}
                                </select>
                            </div>

                            {/* Status Dropdown */}
                            <div>
                                <label htmlFor="status" className="block text-sm font-medium text-gray-300 mb-1">
                                    User Status
                                </label>
                                <select
                                    id="status"
                                    name="status"
                                    value={criteria.status || ''}
                                    onChange={handleCriteriaChange}
                                    disabled={isSending}
                                    className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white disabled:opacity-50"
                                >
                                    <option value="">-- All Statuses --</option>
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                    <option value="pending">Pending</option>
                                    {/* TODO: Ensure these match backend user statuses */}
                                </select>
                            </div>

                            {/* Registration Date Range */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="registrationDateFrom" className="block text-sm font-medium text-gray-300 mb-1">
                                        Registered From
                                    </label>
                                    <input
                                        type="date"
                                        id="registrationDateFrom"
                                        name="registrationDateFrom"
                                        value={criteria.registrationDateFrom || ''}
                                        onChange={handleCriteriaChange}
                                        disabled={isSending}
                                        className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white disabled:opacity-50"
                                    // Add max={criteria.registrationDateTo} if needed
                                    />
                                </div>
                                <div>
                                    <label htmlFor="registrationDateTo" className="block text-sm font-medium text-gray-300 mb-1">
                                        Registered To
                                    </label>
                                    <input
                                        type="date"
                                        id="registrationDateTo"
                                        name="registrationDateTo"
                                        value={criteria.registrationDateTo || ''}
                                        onChange={handleCriteriaChange}
                                        disabled={isSending}
                                        className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white disabled:opacity-50"
                                    // Add min={criteria.registrationDateFrom} if needed
                                    />
                                </div>
                            </div>

                            {/* Subscription Plan Dropdown */}
                            <div>
                                <label htmlFor="subscriptionPlanId" className="block text-sm font-medium text-gray-300 mb-1">
                                    Subscription Plan
                                </label>
                                <select
                                    id="subscriptionPlanId"
                                    name="subscriptionPlanId"
                                    value={criteria.subscriptionPlanId || ''}
                                    onChange={handleCriteriaChange}
                                    disabled={isSending || isLoadingPlans}
                                    className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white disabled:opacity-50"
                                >
                                    <option value="">
                                        {isLoadingPlans ? 'Loading plans...' : '-- All Plans --'}
                                    </option>
                                    {subscriptionPlans.map(plan => (
                                        <option key={plan._id} value={plan._id}>
                                            {plan.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Subscription Status Dropdown */}
                            <div>
                                <label htmlFor="subscriptionStatus" className="block text-sm font-medium text-gray-300 mb-1">
                                    Subscription Status
                                </label>
                                <select
                                    id="subscriptionStatus"
                                    name="subscriptionStatus"
                                    value={criteria.subscriptionStatus || ''}
                                    onChange={handleCriteriaChange}
                                    disabled={isSending}
                                    className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white disabled:opacity-50"
                                >
                                    <option value="">-- All Statuses --</option>
                                    <option value="active">Active</option>
                                    <option value="expired">Expired</option>
                                    <option value="cancelled">Cancelled</option>
                                    <option value="pending_payment">Pending Payment</option>
                                    {/* TODO: Ensure these match backend subscription statuses */}
                                </select>
                            </div>

                            {/* TODO: Add more criteria fields as needed (e.g., country, last login) */}
                        </div>
                    )}

                    {/* --- Common Fields: Subject & Body --- */}
                    {/* Subject */}
                    <div>
                        <label htmlFor="subject" className="block text-sm font-medium text-gray-300 mb-1">
                            Subject
                        </label>
                        <input
                            type="text"
                            id="subject"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            disabled={isSending}
                            className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white placeholder-gray-400 disabled:opacity-50"
                            placeholder="Notification Subject"
                            required
                        />
                    </div>

                    {/* Body */}
                    <div>
                        <label htmlFor="body" className="block text-sm font-medium text-gray-300 mb-1">
                            Body
                        </label>
                        <textarea
                            id="body"
                            rows={8}
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            disabled={isSending}
                            className="block w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white placeholder-gray-400 disabled:opacity-50"
                            placeholder="Enter notification body here... Supports plain text."
                            required
                        />
                    </div>

                    {/* Error Display */}
                    {error && (
                        <div className="p-3 bg-red-900 border border-red-700 rounded-md text-red-100 text-sm flex items-center">
                            <AlertTriangle className="h-4 w-4 mr-2 flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Submit Button */}
                    <div>
                        <button
                            type="submit"
                            disabled={isSending || (sendMode === 'manual' && selectedUsers.length === 0)} // Basic disable logic
                            className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSending ? (
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            ) : (
                                <Send className="mr-2 h-5 w-5" />
                            )}
                            Send Notification(s)
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default NotificationsPage;
