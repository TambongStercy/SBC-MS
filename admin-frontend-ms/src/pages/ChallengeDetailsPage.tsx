import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    getChallengeById,
    listEntrepreneurs,
    listVotes,
    addEntrepreneur,
    approveEntrepreneur,
    deleteEntrepreneur,
    updateChallengeStatus,
    previewFundDistribution,
    executeFundDistribution,
    ImpactChallenge,
    Entrepreneur,
    ChallengeVote,
    ChallengeStatus,
    VoteType,
    FundDistributionPreview
} from '../services/impactChallengeApi';
import Header from '../components/common/Header';
import ConfirmationModal from '../components/common/ConfirmationModal';
import Pagination from '../components/common/Pagination';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';

// Helper to format date strings
const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
        return format(parseISO(dateString), 'MMM dd, yyyy');
    } catch {
        return 'Invalid Date';
    }
};

// Format currency
const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR').format(amount) + ' CFA';
};

// Status badge
const getStatusBadge = (status: ChallengeStatus) => {
    const styles: Record<ChallengeStatus, string> = {
        [ChallengeStatus.DRAFT]: 'bg-gray-100 text-gray-800',
        [ChallengeStatus.ACTIVE]: 'bg-green-100 text-green-800',
        [ChallengeStatus.VOTING_CLOSED]: 'bg-yellow-100 text-yellow-800',
        [ChallengeStatus.FUNDS_DISTRIBUTED]: 'bg-blue-100 text-blue-800',
        [ChallengeStatus.CANCELLED]: 'bg-red-100 text-red-800',
    };
    return (
        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
            {status.toUpperCase().replace('_', ' ')}
        </span>
    );
};

// Tab types
type TabType = 'entrepreneurs' | 'votes' | 'analytics';

// Add Entrepreneur Modal
interface AddEntrepreneurModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: { name: string; projectTitle: string; description: string }) => Promise<void>;
    isSubmitting: boolean;
}

const AddEntrepreneurModal: React.FC<AddEntrepreneurModalProps> = ({ isOpen, onClose, onSubmit, isSubmitting }) => {
    const [name, setName] = useState('');
    const [projectTitle, setProjectTitle] = useState('');
    const [description, setDescription] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !projectTitle.trim() || !description.trim()) {
            toast.error('All fields are required');
            return;
        }
        await onSubmit({ name: name.trim(), projectTitle: projectTitle.trim(), description: description.trim() });
        setName('');
        setProjectTitle('');
        setDescription('');
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h2 className="text-xl font-bold mb-4">Add Entrepreneur</h2>
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full border rounded-md px-3 py-2"
                            placeholder="Entrepreneur's full name"
                            required
                        />
                    </div>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Project Title</label>
                        <input
                            type="text"
                            value={projectTitle}
                            onChange={(e) => setProjectTitle(e.target.value)}
                            className="w-full border rounded-md px-3 py-2"
                            placeholder="Name of their project/business"
                            required
                        />
                    </div>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full border rounded-md px-3 py-2"
                            rows={4}
                            placeholder="Brief description of their project..."
                            required
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
                            {isSubmitting ? 'Adding...' : 'Add Entrepreneur'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Fund Distribution Modal
interface FundDistributionModalProps {
    isOpen: boolean;
    onClose: () => void;
    preview: FundDistributionPreview | null;
    onExecute: () => Promise<void>;
    isExecuting: boolean;
}

const FundDistributionModal: React.FC<FundDistributionModalProps> = ({
    isOpen,
    onClose,
    preview,
    onExecute,
    isExecuting
}) => {
    if (!isOpen || !preview) return null;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
                <h2 className="text-xl font-bold mb-4">Fund Distribution Preview</h2>

                <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-700 mb-2">Challenge</h3>
                    <p className="text-gray-600">{preview.challenge.campaignName}</p>
                    <p className="text-2xl font-bold text-gray-900">{formatCurrency(preview.challenge.totalCollected)}</p>
                </div>

                <div className="space-y-4 mb-6">
                    {/* Winner Distribution */}
                    <div className="bg-green-50 p-4 rounded-lg">
                        <div className="flex justify-between items-center">
                            <div>
                                <h4 className="font-semibold text-green-800">Winner ({preview.winner.percentage}%)</h4>
                                <p className="text-sm text-green-600">{preview.winner.name}</p>
                                <p className="text-xs text-green-500">{preview.winner.projectTitle}</p>
                            </div>
                            <p className="text-xl font-bold text-green-800">{formatCurrency(preview.winner.amountToReceive)}</p>
                        </div>
                    </div>

                    {/* Lottery Pool */}
                    <div className="bg-blue-50 p-4 rounded-lg">
                        <div className="flex justify-between items-center">
                            <div>
                                <h4 className="font-semibold text-blue-800">Lottery Pool ({preview.lotteryPool.percentage}%)</h4>
                                <p className="text-sm text-blue-600">Added to monthly lottery prize</p>
                            </div>
                            <p className="text-xl font-bold text-blue-800">{formatCurrency(preview.lotteryPool.amount)}</p>
                        </div>
                    </div>

                    {/* SBC Commission */}
                    <div className="bg-purple-50 p-4 rounded-lg">
                        <div className="flex justify-between items-center">
                            <div>
                                <h4 className="font-semibold text-purple-800">SBC Commission ({preview.sbcCommission.percentage}%)</h4>
                                <p className="text-sm text-purple-600">Platform fee</p>
                            </div>
                            <p className="text-xl font-bold text-purple-800">{formatCurrency(preview.sbcCommission.amount)}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-yellow-700">
                                <strong>Warning:</strong> This action cannot be undone. Funds will be transferred immediately.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end space-x-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50"
                        disabled={isExecuting}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onExecute}
                        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                        disabled={isExecuting}
                    >
                        {isExecuting ? 'Distributing...' : 'Confirm Distribution'}
                    </button>
                </div>
            </div>
        </div>
    );
};

function ChallengeDetailsPage() {
    const { challengeId } = useParams<{ challengeId: string }>();
    const navigate = useNavigate();

    // Challenge state
    const [challenge, setChallenge] = useState<ImpactChallenge | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Tab state
    const [activeTab, setActiveTab] = useState<TabType>('entrepreneurs');

    // Entrepreneurs state
    const [entrepreneurs, setEntrepreneurs] = useState<Entrepreneur[]>([]);
    const [isLoadingEntrepreneurs, setIsLoadingEntrepreneurs] = useState(false);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isAddingEntrepreneur, setIsAddingEntrepreneur] = useState(false);

    // Votes state
    const [votes, setVotes] = useState<ChallengeVote[]>([]);
    const [isLoadingVotes, setIsLoadingVotes] = useState(false);
    const [votesPagination, setVotesPagination] = useState({ page: 1, limit: 20 });
    const [votesTotalPages, setVotesTotalPages] = useState(1);

    // Fund distribution state
    const [isDistributionModalOpen, setIsDistributionModalOpen] = useState(false);
    const [distributionPreview, setDistributionPreview] = useState<FundDistributionPreview | null>(null);
    const [isExecutingDistribution, setIsExecutingDistribution] = useState(false);

    // Confirmation modals
    const [confirmAction, setConfirmAction] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => Promise<void>;
    }>({ isOpen: false, title: '', message: '', onConfirm: async () => {} });

    // Fetch challenge details
    const fetchChallenge = useCallback(async () => {
        if (!challengeId) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await getChallengeById(challengeId);
            setChallenge(data);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load challenge';
            setError(message);
            toast.error(message);
        } finally {
            setIsLoading(false);
        }
    }, [challengeId]);

    // Fetch entrepreneurs
    const fetchEntrepreneurs = useCallback(async () => {
        if (!challengeId) return;
        setIsLoadingEntrepreneurs(true);
        try {
            const response = await listEntrepreneurs(challengeId);
            setEntrepreneurs(response.data || []);
        } catch (err) {
            toast.error('Failed to load entrepreneurs');
        } finally {
            setIsLoadingEntrepreneurs(false);
        }
    }, [challengeId]);

    // Fetch votes
    const fetchVotes = useCallback(async () => {
        if (!challengeId) return;
        setIsLoadingVotes(true);
        try {
            const response = await listVotes(challengeId, votesPagination);
            setVotes(response.data || []);
            setVotesTotalPages(response.pagination?.totalPages || 1);
        } catch (err) {
            toast.error('Failed to load votes');
        } finally {
            setIsLoadingVotes(false);
        }
    }, [challengeId, votesPagination]);

    useEffect(() => {
        fetchChallenge();
    }, [fetchChallenge]);

    useEffect(() => {
        if (activeTab === 'entrepreneurs') {
            fetchEntrepreneurs();
        } else if (activeTab === 'votes') {
            fetchVotes();
        }
    }, [activeTab, fetchEntrepreneurs, fetchVotes]);

    // Add entrepreneur handler
    const handleAddEntrepreneur = async (data: { name: string; projectTitle: string; description: string }) => {
        if (!challengeId) return;
        setIsAddingEntrepreneur(true);
        try {
            await addEntrepreneur(challengeId, data);
            toast.success('Entrepreneur added successfully');
            setIsAddModalOpen(false);
            fetchEntrepreneurs();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to add entrepreneur';
            toast.error(message);
            throw err;
        } finally {
            setIsAddingEntrepreneur(false);
        }
    };

    // Approve entrepreneur handler
    const handleApproveEntrepreneur = async (entrepreneurId: string) => {
        const loadingId = toast.loading('Approving entrepreneur...');
        try {
            await approveEntrepreneur(entrepreneurId);
            toast.success('Entrepreneur approved', { id: loadingId });
            fetchEntrepreneurs();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to approve';
            toast.error(message, { id: loadingId });
        }
    };

    // Delete entrepreneur handler
    const handleDeleteEntrepreneur = async (entrepreneur: Entrepreneur) => {
        setConfirmAction({
            isOpen: true,
            title: 'Delete Entrepreneur',
            message: `Are you sure you want to remove "${entrepreneur.name}" from this challenge?`,
            onConfirm: async () => {
                const loadingId = toast.loading('Deleting entrepreneur...');
                try {
                    await deleteEntrepreneur(entrepreneur._id);
                    toast.success('Entrepreneur deleted', { id: loadingId });
                    setConfirmAction(prev => ({ ...prev, isOpen: false }));
                    fetchEntrepreneurs();
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Failed to delete';
                    toast.error(message, { id: loadingId });
                }
            }
        });
    };

    // Fund distribution handlers
    const handleOpenDistribution = async () => {
        if (!challengeId) return;
        const loadingId = toast.loading('Generating preview...');
        try {
            const preview = await previewFundDistribution(challengeId);
            setDistributionPreview(preview);
            setIsDistributionModalOpen(true);
            toast.dismiss(loadingId);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to generate preview';
            toast.error(message, { id: loadingId });
        }
    };

    const handleExecuteDistribution = async () => {
        if (!challengeId) return;
        setIsExecutingDistribution(true);
        const loadingId = toast.loading('Distributing funds...');
        try {
            await executeFundDistribution(challengeId);
            toast.success('Funds distributed successfully!', { id: loadingId });
            setIsDistributionModalOpen(false);
            setDistributionPreview(null);
            fetchChallenge();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Distribution failed';
            toast.error(message, { id: loadingId });
        } finally {
            setIsExecutingDistribution(false);
        }
    };

    // Close voting handler
    const handleCloseVoting = async () => {
        if (!challengeId || !challenge) return;
        setConfirmAction({
            isOpen: true,
            title: 'Close Voting',
            message: 'Are you sure you want to close voting for this challenge? No more votes will be accepted.',
            onConfirm: async () => {
                const loadingId = toast.loading('Closing voting...');
                try {
                    await updateChallengeStatus(challengeId, ChallengeStatus.VOTING_CLOSED);
                    toast.success('Voting closed', { id: loadingId });
                    setConfirmAction(prev => ({ ...prev, isOpen: false }));
                    fetchChallenge();
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Failed to close voting';
                    toast.error(message, { id: loadingId });
                }
            }
        });
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-100">
                <Header title="Challenge Details" />
                <div className="flex items-center justify-center h-64">
                    <svg className="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                </div>
            </div>
        );
    }

    if (error || !challenge) {
        return (
            <div className="min-h-screen bg-gray-100">
                <Header title="Challenge Details" />
                <div className="max-w-7xl mx-auto py-6 px-4">
                    <div className="bg-red-50 border-l-4 border-red-400 p-4">
                        <p className="text-red-700">{error || 'Challenge not found'}</p>
                    </div>
                    <button
                        onClick={() => navigate('/impact-challenges')}
                        className="mt-4 text-indigo-600 hover:text-indigo-800"
                    >
                        Back to Challenges
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100">
            <Header title="Challenge Details" />
            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                {/* Back button and header */}
                <div className="px-4 sm:px-0 mb-6">
                    <button
                        onClick={() => navigate('/impact-challenges')}
                        className="text-indigo-600 hover:text-indigo-800 flex items-center mb-4"
                    >
                        <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        Back to Challenges
                    </button>

                    <div className="flex justify-between items-start">
                        <div>
                            <h1 className="text-2xl font-semibold text-gray-900">{challenge.campaignName}</h1>
                            <div className="mt-2 flex items-center space-x-4">
                                {getStatusBadge(challenge.status)}
                                <span className="text-sm text-gray-500">
                                    {formatDate(challenge.startDate)} - {formatDate(challenge.endDate)}
                                </span>
                            </div>
                        </div>

                        {/* Action buttons based on status */}
                        <div className="space-x-2">
                            {challenge.status === ChallengeStatus.ACTIVE && (
                                <button
                                    onClick={handleCloseVoting}
                                    className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600"
                                >
                                    Close Voting
                                </button>
                            )}
                            {challenge.status === ChallengeStatus.VOTING_CLOSED && !challenge.fundsDistributed && (
                                <button
                                    onClick={handleOpenDistribution}
                                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                                >
                                    Distribute Funds
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Stats cards */}
                <div className="px-4 sm:px-0 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-white rounded-lg shadow p-4">
                            <p className="text-sm text-gray-500">Total Collected</p>
                            <p className="text-2xl font-bold text-gray-900">{formatCurrency(challenge.totalCollected)}</p>
                        </div>
                        <div className="bg-white rounded-lg shadow p-4">
                            <p className="text-sm text-gray-500">Total Votes</p>
                            <p className="text-2xl font-bold text-gray-900">{challenge.totalVoteCount.toLocaleString()}</p>
                        </div>
                        <div className="bg-white rounded-lg shadow p-4">
                            <p className="text-sm text-gray-500">Entrepreneurs</p>
                            <p className="text-2xl font-bold text-gray-900">{entrepreneurs.length}</p>
                        </div>
                        <div className="bg-white rounded-lg shadow p-4">
                            <p className="text-sm text-gray-500">Funds Distributed</p>
                            <p className="text-2xl font-bold text-gray-900">{challenge.fundsDistributed ? 'Yes' : 'No'}</p>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="px-4 sm:px-0 mb-4">
                    <div className="border-b border-gray-200">
                        <nav className="-mb-px flex space-x-8">
                            {(['entrepreneurs', 'votes', 'analytics'] as TabType[]).map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`py-4 px-1 border-b-2 font-medium text-sm ${
                                        activeTab === tab
                                            ? 'border-indigo-500 text-indigo-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                                >
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            ))}
                        </nav>
                    </div>
                </div>

                {/* Tab Content */}
                <div className="bg-white shadow sm:rounded-lg">
                    {/* Entrepreneurs Tab */}
                    {activeTab === 'entrepreneurs' && (
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-medium text-gray-900">Entrepreneurs</h3>
                                {challenge.status === ChallengeStatus.DRAFT && entrepreneurs.length < 3 && (
                                    <button
                                        onClick={() => setIsAddModalOpen(true)}
                                        className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                                    >
                                        Add Entrepreneur
                                    </button>
                                )}
                            </div>

                            {isLoadingEntrepreneurs ? (
                                <div className="text-center py-8">Loading...</div>
                            ) : entrepreneurs.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    No entrepreneurs added yet. Add up to 3 entrepreneurs to this challenge.
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {entrepreneurs.map((entrepreneur, index) => (
                                        <div key={entrepreneur._id} className="border rounded-lg p-4">
                                            <div className="flex justify-between items-start">
                                                <div className="flex-1">
                                                    <div className="flex items-center space-x-2">
                                                        <span className="text-lg font-semibold text-gray-900">
                                                            #{index + 1} {entrepreneur.name}
                                                        </span>
                                                        {entrepreneur.approved ? (
                                                            <span className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded-full">
                                                                Approved
                                                            </span>
                                                        ) : (
                                                            <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full">
                                                                Pending Approval
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-sm font-medium text-indigo-600">{entrepreneur.projectTitle}</p>
                                                    <p className="text-sm text-gray-500 mt-1">{entrepreneur.description}</p>
                                                    <div className="mt-2 flex space-x-4 text-sm text-gray-600">
                                                        <span>Votes: <strong>{entrepreneur.voteCount}</strong></span>
                                                        <span>Amount: <strong>{formatCurrency(entrepreneur.amountCollected)}</strong></span>
                                                    </div>
                                                </div>
                                                <div className="space-x-2">
                                                    {!entrepreneur.approved && challenge.status === ChallengeStatus.DRAFT && (
                                                        <button
                                                            onClick={() => handleApproveEntrepreneur(entrepreneur._id)}
                                                            className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600"
                                                        >
                                                            Approve
                                                        </button>
                                                    )}
                                                    {challenge.status === ChallengeStatus.DRAFT && (
                                                        <button
                                                            onClick={() => handleDeleteEntrepreneur(entrepreneur)}
                                                            className="px-3 py-1 text-sm text-red-600 hover:text-red-800"
                                                        >
                                                            Delete
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Votes Tab */}
                    {activeTab === 'votes' && (
                        <div className="p-6">
                            <h3 className="text-lg font-medium text-gray-900 mb-4">Vote History</h3>

                            {isLoadingVotes ? (
                                <div className="text-center py-8">Loading...</div>
                            ) : votes.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">No votes recorded yet.</div>
                            ) : (
                                <>
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Voter/Supporter</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Votes</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tickets</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {votes.map((vote) => (
                                                <tr key={vote._id}>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <span className={`px-2 py-1 text-xs rounded-full ${
                                                            vote.voteType === VoteType.VOTE
                                                                ? 'bg-indigo-100 text-indigo-800'
                                                                : 'bg-green-100 text-green-800'
                                                        }`}>
                                                            {vote.voteType.toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                        {vote.isAnonymous ? 'Anonymous' : (vote.supporterName || vote.userId || 'Member')}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                        {formatCurrency(vote.amountPaid)}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                        {vote.voteQuantity}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                        {vote.voteType === VoteType.VOTE ? vote.tombolaTicketIds.length : '-'}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                        {formatDate(vote.createdAt)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    {votesTotalPages > 1 && (
                                        <div className="mt-4">
                                            <Pagination
                                                currentPage={votesPagination.page}
                                                totalPages={votesTotalPages}
                                                onPageChange={(page) => setVotesPagination(prev => ({ ...prev, page }))}
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* Analytics Tab */}
                    {activeTab === 'analytics' && (
                        <div className="p-6">
                            <h3 className="text-lg font-medium text-gray-900 mb-4">Analytics</h3>

                            {/* Leaderboard */}
                            <div className="mb-8">
                                <h4 className="text-md font-medium text-gray-700 mb-3">Entrepreneur Leaderboard</h4>
                                <div className="space-y-3">
                                    {entrepreneurs
                                        .sort((a, b) => b.voteCount - a.voteCount)
                                        .map((entrepreneur, index) => {
                                            const totalVotes = entrepreneurs.reduce((sum, e) => sum + e.voteCount, 0);
                                            const percentage = totalVotes > 0 ? (entrepreneur.voteCount / totalVotes) * 100 : 0;
                                            return (
                                                <div key={entrepreneur._id} className="relative">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className="text-sm font-medium">
                                                            #{index + 1} {entrepreneur.name}
                                                        </span>
                                                        <span className="text-sm text-gray-600">
                                                            {entrepreneur.voteCount} votes ({percentage.toFixed(1)}%)
                                                        </span>
                                                    </div>
                                                    <div className="w-full bg-gray-200 rounded-full h-4">
                                                        <div
                                                            className={`h-4 rounded-full ${
                                                                index === 0 ? 'bg-yellow-400' :
                                                                index === 1 ? 'bg-gray-400' :
                                                                'bg-orange-400'
                                                            }`}
                                                            style={{ width: `${percentage}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>

                            {/* Summary Stats */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-gray-50 rounded-lg p-4">
                                    <p className="text-sm text-gray-500">Total Votes</p>
                                    <p className="text-xl font-bold">{challenge.totalVoteCount}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-4">
                                    <p className="text-sm text-gray-500">Total Amount</p>
                                    <p className="text-xl font-bold">{formatCurrency(challenge.totalCollected)}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-4">
                                    <p className="text-sm text-gray-500">Winner Share (50%)</p>
                                    <p className="text-xl font-bold">{formatCurrency(challenge.totalCollected * 0.5)}</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-4">
                                    <p className="text-sm text-gray-500">Lottery Pool (30%)</p>
                                    <p className="text-xl font-bold">{formatCurrency(challenge.totalCollected * 0.3)}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* Modals */}
            <AddEntrepreneurModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSubmit={handleAddEntrepreneur}
                isSubmitting={isAddingEntrepreneur}
            />

            <FundDistributionModal
                isOpen={isDistributionModalOpen}
                onClose={() => {
                    setIsDistributionModalOpen(false);
                    setDistributionPreview(null);
                }}
                preview={distributionPreview}
                onExecute={handleExecuteDistribution}
                isExecuting={isExecutingDistribution}
            />

            <ConfirmationModal
                isOpen={confirmAction.isOpen}
                title={confirmAction.title}
                message={confirmAction.message}
                confirmText="Confirm"
                cancelText="Cancel"
                onConfirm={confirmAction.onConfirm}
                onCancel={() => setConfirmAction(prev => ({ ...prev, isOpen: false }))}
            />
        </div>
    );
}

export default ChallengeDetailsPage;
