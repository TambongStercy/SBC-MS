import React, { useState, useEffect, useCallback } from 'react';
import {
    listChallenges,
    createChallenge,
    updateChallengeStatus,
    deleteChallenge,
    ImpactChallenge,
    ChallengeStatus,
    PaginationOptions
} from '../services/impactChallengeApi';
import Header from '../components/common/Header';
import Pagination from '../components/common/Pagination';
import ConfirmationModal from '../components/common/ConfirmationModal';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

// Helper to format date strings
const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
        return format(parseISO(dateString), 'MMM dd, yyyy');
    } catch (error) {
        console.error("Error formatting date:", dateString, error);
        return 'Invalid Date';
    }
};

// Helper for status badges
const getStatusBadge = (status: ChallengeStatus) => {
    switch (status) {
        case ChallengeStatus.DRAFT:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">DRAFT</span>;
        case ChallengeStatus.ACTIVE:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">ACTIVE</span>;
        case ChallengeStatus.VOTING_CLOSED:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">VOTING CLOSED</span>;
        case ChallengeStatus.FUNDS_DISTRIBUTED:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">DISTRIBUTED</span>;
        case ChallengeStatus.CANCELLED:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">CANCELLED</span>;
        default:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">UNKNOWN</span>;
    }
};

// Format currency
const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR').format(amount) + ' CFA';
};

// Create Challenge Modal Component
interface CreateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: { campaignName: string; month: number; year: number; startDate: string; endDate: string; description?: string }) => Promise<void>;
    isSubmitting: boolean;
}

const CreateChallengeModal: React.FC<CreateModalProps> = ({ isOpen, onClose, onSubmit, isSubmitting }) => {
    const currentDate = new Date();
    const [campaignName, setCampaignName] = useState('');
    const [month, setMonth] = useState(currentDate.getMonth() + 1);
    const [year, setYear] = useState(currentDate.getFullYear());
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [description, setDescription] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!campaignName.trim()) {
            toast.error('Campaign name is required');
            return;
        }
        if (!startDate || !endDate) {
            toast.error('Start and end dates are required');
            return;
        }
        await onSubmit({
            campaignName: campaignName.trim(),
            month,
            year,
            startDate,
            endDate,
            description: description.trim() || undefined
        });
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h2 className="text-xl font-bold mb-4">Create Impact Challenge</h2>
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
                        <input
                            type="text"
                            value={campaignName}
                            onChange={(e) => setCampaignName(e.target.value)}
                            className="w-full border rounded-md px-3 py-2"
                            placeholder="e.g., December 2024 Impact Challenge"
                            required
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
                            <select
                                value={month}
                                onChange={(e) => setMonth(parseInt(e.target.value))}
                                className="w-full border rounded-md px-3 py-2"
                            >
                                {[...Array(12)].map((_, i) => (
                                    <option key={i + 1} value={i + 1}>
                                        {new Date(2000, i).toLocaleString('default', { month: 'long' })}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                            <select
                                value={year}
                                onChange={(e) => setYear(parseInt(e.target.value))}
                                className="w-full border rounded-md px-3 py-2"
                            >
                                {[currentDate.getFullYear(), currentDate.getFullYear() + 1].map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-full border rounded-md px-3 py-2"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="w-full border rounded-md px-3 py-2"
                                required
                            />
                        </div>
                    </div>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full border rounded-md px-3 py-2"
                            rows={3}
                            placeholder="Brief description of this challenge..."
                        />
                    </div>
                    <div className="flex justify-end space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50"
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Creating...' : 'Create Challenge'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

function ImpactChallengePage() {
    const [challenges, setChallenges] = useState<ImpactChallenge[]>([]);
    const [pagination, setPagination] = useState<PaginationOptions>({ page: 1, limit: 10 });
    const [totalPages, setTotalPages] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

    // Status change state
    const [isConfirmStatusModalOpen, setIsConfirmStatusModalOpen] = useState<boolean>(false);
    const [challengeToChangeStatus, setChallengeToChangeStatus] = useState<ImpactChallenge | null>(null);
    const [targetStatus, setTargetStatus] = useState<ChallengeStatus | null>(null);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState<boolean>(false);

    // Delete state
    const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState<boolean>(false);
    const [challengeToDelete, setChallengeToDelete] = useState<ImpactChallenge | null>(null);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);

    const navigate = useNavigate();

    const fetchChallenges = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await listChallenges(pagination);
            setChallenges(response.data || []);
            setTotalPages(response.pagination?.totalPages || 1);
            if (response.pagination?.page && response.pagination.page !== pagination.page) {
                setPagination(prev => ({ ...prev, page: response.pagination.page }));
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred';
            setError(message);
            toast.error(`Failed to load challenges: ${message}`);
            setChallenges([]);
            setTotalPages(1);
        } finally {
            setIsLoading(false);
        }
    }, [pagination]);

    useEffect(() => {
        fetchChallenges();
    }, [fetchChallenges]);

    const handlePageChange = (newPage: number) => {
        if (newPage > 0 && newPage <= totalPages) {
            setPagination(prev => ({ ...prev, page: newPage }));
        }
    };

    const handleCreateChallenge = async (data: {
        campaignName: string;
        month: number;
        year: number;
        startDate: string;
        endDate: string;
        description?: string;
    }) => {
        setIsSubmitting(true);
        const loadingToastId = toast.loading('Creating new challenge...');
        try {
            await createChallenge(data);
            toast.success(`Successfully created challenge: ${data.campaignName}`, { id: loadingToastId });
            setIsCreateModalOpen(false);
            fetchChallenges();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred';
            toast.error(`Failed to create challenge: ${message}`, { id: loadingToastId });
            throw err;
        } finally {
            setIsSubmitting(false);
        }
    };

    // Status change handlers
    const handleStatusChangeClick = (challenge: ImpactChallenge, newStatus: ChallengeStatus) => {
        setChallengeToChangeStatus(challenge);
        setTargetStatus(newStatus);
        setIsConfirmStatusModalOpen(true);
    };

    const handleConfirmStatusChange = async () => {
        if (!challengeToChangeStatus || !targetStatus) return;

        setIsUpdatingStatus(true);
        const loadingToastId = toast.loading(`Updating status to ${targetStatus}...`);
        try {
            await updateChallengeStatus(challengeToChangeStatus._id, targetStatus);
            toast.success(`Status updated to ${targetStatus}`, { id: loadingToastId });
            setIsConfirmStatusModalOpen(false);
            setChallengeToChangeStatus(null);
            setTargetStatus(null);
            fetchChallenges();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred';
            toast.error(`Failed to update status: ${message}`, { id: loadingToastId });
        } finally {
            setIsUpdatingStatus(false);
        }
    };

    // Delete handlers
    const handleDeleteClick = (challenge: ImpactChallenge) => {
        setChallengeToDelete(challenge);
        setIsConfirmDeleteModalOpen(true);
    };

    const handleConfirmDelete = async () => {
        if (!challengeToDelete) return;

        setIsDeleting(true);
        const loadingToastId = toast.loading('Deleting challenge...');
        try {
            await deleteChallenge(challengeToDelete._id);
            toast.success(`Challenge deleted successfully`, { id: loadingToastId });
            setIsConfirmDeleteModalOpen(false);
            setChallengeToDelete(null);
            fetchChallenges();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred';
            toast.error(`Failed to delete challenge: ${message}`, { id: loadingToastId });
        } finally {
            setIsDeleting(false);
        }
    };

    // Navigate to details page
    const handleViewDetails = (challengeId: string) => {
        navigate(`/impact-challenges/${challengeId}`);
    };

    // Get available status transitions
    const getAvailableStatusActions = (status: ChallengeStatus) => {
        switch (status) {
            case ChallengeStatus.DRAFT:
                return [{ label: 'Activate', status: ChallengeStatus.ACTIVE, color: 'bg-green-500 hover:bg-green-600' }];
            case ChallengeStatus.ACTIVE:
                return [{ label: 'Close Voting', status: ChallengeStatus.VOTING_CLOSED, color: 'bg-yellow-500 hover:bg-yellow-600' }];
            case ChallengeStatus.VOTING_CLOSED:
                return []; // Distribution is done via details page
            case ChallengeStatus.FUNDS_DISTRIBUTED:
            case ChallengeStatus.CANCELLED:
                return [];
            default:
                return [];
        }
    };

    return (
        <div className="min-h-screen bg-gray-100">
            <Header title="Impact Challenge" />
            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                {/* Header Section */}
                <div className="px-4 py-4 sm:px-0 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-semibold text-gray-900">Impact Challenge Management</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Manage monthly entrepreneur support campaigns
                        </p>
                    </div>
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                        <svg className="-ml-1 mr-2 h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                        </svg>
                        New Challenge
                    </button>
                </div>

                {/* Error Display */}
                {error && !isLoading && (
                    <div className="px-4 sm:px-0 mb-4">
                        <div className="bg-red-50 border-l-4 border-red-400 p-4">
                            <div className="flex">
                                <div className="flex-shrink-0">
                                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <div className="ml-3">
                                    <p className="text-sm text-red-700">{error}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Challenges Table */}
                <div className="bg-white shadow overflow-hidden sm:rounded-lg">
                    {isLoading ? (
                        <div className="p-8 text-center">
                            <svg className="animate-spin h-8 w-8 mx-auto text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <p className="mt-2 text-gray-500">Loading challenges...</p>
                        </div>
                    ) : challenges.length === 0 ? (
                        <div className="p-8 text-center">
                            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            <h3 className="mt-2 text-sm font-medium text-gray-900">No challenges yet</h3>
                            <p className="mt-1 text-sm text-gray-500">Get started by creating a new Impact Challenge.</p>
                        </div>
                    ) : (
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Period</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Votes</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Collected</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {challenges.map((challenge) => (
                                    <tr key={challenge._id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">{challenge.campaignName}</div>
                                            <div className="text-sm text-gray-500">
                                                {new Date(2000, challenge.month - 1).toLocaleString('default', { month: 'long' })} {challenge.year}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-900">{formatDate(challenge.startDate)}</div>
                                            <div className="text-sm text-gray-500">to {formatDate(challenge.endDate)}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {getStatusBadge(challenge.status)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {challenge.totalVoteCount.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                            {formatCurrency(challenge.totalCollected)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                            <button
                                                onClick={() => handleViewDetails(challenge._id)}
                                                className="text-indigo-600 hover:text-indigo-900"
                                            >
                                                View
                                            </button>
                                            {getAvailableStatusActions(challenge.status).map((action) => (
                                                <button
                                                    key={action.status}
                                                    onClick={() => handleStatusChangeClick(challenge, action.status)}
                                                    className={`px-2 py-1 text-xs text-white rounded ${action.color}`}
                                                >
                                                    {action.label}
                                                </button>
                                            ))}
                                            {challenge.status === ChallengeStatus.DRAFT && (
                                                <button
                                                    onClick={() => handleDeleteClick(challenge)}
                                                    className="text-red-600 hover:text-red-900"
                                                >
                                                    Delete
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {/* Pagination */}
                    {!isLoading && challenges.length > 0 && (
                        <div className="px-6 py-4 border-t border-gray-200">
                            <Pagination
                                currentPage={pagination.page || 1}
                                totalPages={totalPages}
                                onPageChange={handlePageChange}
                            />
                        </div>
                    )}
                </div>
            </main>

            {/* Create Modal */}
            <CreateChallengeModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSubmit={handleCreateChallenge}
                isSubmitting={isSubmitting}
            />

            {/* Status Change Confirmation Modal */}
            {challengeToChangeStatus && targetStatus && (
                <ConfirmationModal
                    isOpen={isConfirmStatusModalOpen}
                    title="Confirm Status Change"
                    message={`Are you sure you want to change the status of "${challengeToChangeStatus.campaignName}" to "${targetStatus}"?`}
                    confirmText={isUpdatingStatus ? "Updating..." : "Confirm"}
                    cancelText="Cancel"
                    onConfirm={handleConfirmStatusChange}
                    onCancel={() => {
                        setIsConfirmStatusModalOpen(false);
                        setChallengeToChangeStatus(null);
                        setTargetStatus(null);
                    }}
                />
            )}

            {/* Delete Confirmation Modal */}
            {challengeToDelete && (
                <ConfirmationModal
                    isOpen={isConfirmDeleteModalOpen}
                    title="Confirm Delete"
                    message={`Are you sure you want to delete "${challengeToDelete.campaignName}"? This action cannot be undone.`}
                    confirmText={isDeleting ? "Deleting..." : "Delete"}
                    cancelText="Cancel"
                    onConfirm={handleConfirmDelete}
                    onCancel={() => {
                        setIsConfirmDeleteModalOpen(false);
                        setChallengeToDelete(null);
                    }}
                />
            )}
        </div>
    );
}

export default ImpactChallengePage;
