/**
 * User Roles Management Page
 * Unified page for managing all user roles (USER, TESTER, WITHDRAWAL_ADMIN, ADMIN)
 */

import { useState, useEffect } from 'react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import { listUsers, updateUserRole, AdminUserData, AdminUserListFilters } from '../services/adminUserApi';
import { ShieldAlert, Search, Filter } from 'lucide-react';

const UserRolesManagement = () => {
    const { toasts, removeToast, showSuccess, showError, showWarning } = useToast();
    const [users, setUsers] = useState<AdminUserData[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState<string>('');

    // Confirmation modal
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState<{
        title: string;
        message: string;
        onConfirm: () => void;
    } | null>(null);

    useEffect(() => {
        loadUsers();
    }, [currentPage, roleFilter, statusFilter]);

    const loadUsers = async () => {
        try {
            setLoading(true);
            const filters: AdminUserListFilters = {};

            if (searchQuery) filters.search = searchQuery;
            if (roleFilter) filters.role = roleFilter;
            if (statusFilter) filters.status = statusFilter as any;

            const response = await listUsers(filters, { page: currentPage, limit: 20 });
            setUsers(response.data);
            setTotalPages(response.pagination.totalPages);
            setTotalCount(response.pagination.totalCount);
        } catch (error: any) {
            console.error('Error loading users:', error);
            showError(error.message || 'Failed to load users');
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = () => {
        setCurrentPage(1);
        loadUsers();
    };

    const handleRoleChange = (user: AdminUserData, newRole: string) => {
        const isElevatingToAdmin = newRole === 'admin' || newRole === 'withdrawal_admin';

        setConfirmAction({
            title: isElevatingToAdmin ? '⚠️ Confirm Role Change' : 'Change User Role',
            message: isElevatingToAdmin
                ? `You are about to grant ${getRoleDisplayName(newRole)} privileges to ${user.name}. This will give them administrative access. Are you sure?`
                : `Change ${user.name}'s role to ${getRoleDisplayName(newRole)}?`,
            onConfirm: async () => {
                try {
                    await updateUserRole(user._id, newRole);
                    showSuccess(`Role updated to ${getRoleDisplayName(newRole)} for ${user.name}`);
                    loadUsers();
                } catch (error: any) {
                    showError(error.message || 'Failed to update role');
                }
                setShowConfirmModal(false);
            }
        });
        setShowConfirmModal(true);
    };

    const getRoleDisplayName = (role: string): string => {
        const roleNames: Record<string, string> = {
            'user': 'Utilisateur',
            'admin': 'Administrateur',
            'withdrawal_admin': 'Admin Retraits',
            'tester': 'Testeur'
        };
        return roleNames[role] || role;
    };

    const getRoleBadgeColor = (role: string): string => {
        switch (role) {
            case 'admin':
                return 'bg-red-900 text-red-200 border-red-500';
            case 'withdrawal_admin':
                return 'bg-yellow-900 text-yellow-200 border-yellow-500';
            case 'tester':
                return 'bg-purple-900 text-purple-200 border-purple-500';
            default:
                return 'bg-gray-700 text-gray-300 border-gray-500';
        }
    };

    const getRoleIcon = (role: string): string => {
        switch (role) {
            case 'admin':
                return '🛡️';
            case 'withdrawal_admin':
                return '💳';
            case 'tester':
                return '🧪';
            default:
                return '👤';
        }
    };

    if (loading && users.length === 0) {
        return (
            <div className="flex-1 overflow-auto relative z-10 bg-gray-900">
                <Header title="User Roles Management" />
                <div className="flex items-center justify-center h-96">
                    <Loader name="Users" />
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white">
            <Header title="User Roles Management" />

            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                {/* Header */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-2">
                        <ShieldAlert className="text-indigo-400" size={28} />
                        <h2 className="text-2xl font-bold text-white">User Roles Management</h2>
                    </div>
                    <p className="text-gray-400 text-sm">
                        Manage user roles and permissions across the platform
                    </p>
                </div>

                {/* Filters */}
                <div className="bg-gray-800 rounded-lg p-4 mb-6">
                    <div className="flex flex-col lg:flex-row gap-4">
                        {/* Search */}
                        <div className="flex-1">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                                <input
                                    type="text"
                                    placeholder="Search by name, email, or phone..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                                    className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                        </div>

                        {/* Role Filter */}
                        <div className="w-full lg:w-48">
                            <select
                                value={roleFilter}
                                onChange={(e) => {
                                    setRoleFilter(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="">All Roles</option>
                                <option value="user">👤 Utilisateur</option>
                                <option value="tester">🧪 Testeur</option>
                                <option value="withdrawal_admin">💳 Admin Retraits</option>
                                <option value="admin">🛡️ Administrateur</option>
                            </select>
                        </div>

                        {/* Status Filter */}
                        <div className="w-full lg:w-48">
                            <select
                                value={statusFilter}
                                onChange={(e) => {
                                    setStatusFilter(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="">All Status</option>
                                <option value="active">Active</option>
                                <option value="blocked">Blocked</option>
                            </select>
                        </div>

                        {/* Search Button */}
                        <button
                            onClick={handleSearch}
                            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition flex items-center gap-2"
                        >
                            <Filter size={18} />
                            Search
                        </button>
                    </div>
                </div>

                {/* Results Count */}
                <div className="mb-4 text-sm text-gray-400">
                    Showing {users.length} of {totalCount} users
                </div>

                {/* Users Table */}
                <div className="bg-gray-800 rounded-lg shadow overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-700">
                            <thead className="bg-gray-700">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">User</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Contact</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Current Role</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Change Role</th>
                                </tr>
                            </thead>
                            <tbody className="bg-gray-800 divide-y divide-gray-600">
                                {users.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                                            No users found. Try adjusting your filters.
                                        </td>
                                    </tr>
                                ) : (
                                    users.map((user) => (
                                        <tr key={user._id} className="hover:bg-gray-700">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center">
                                                    <div className="flex-shrink-0 h-10 w-10">
                                                        <div className="h-10 w-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold">
                                                            {user.name.charAt(0).toUpperCase()}
                                                        </div>
                                                    </div>
                                                    <div className="ml-4">
                                                        <div className="text-sm font-medium text-white">{user.name}</div>
                                                        <div className="text-sm text-gray-400">{user.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                                <div>{user.phoneNumber || 'N/A'}</div>
                                                <div className="text-xs text-gray-400">{user.country || 'N/A'}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-3 py-1 text-xs font-medium rounded-full border ${getRoleBadgeColor(user.role || 'user')}`}>
                                                    {getRoleIcon(user.role || 'user')} {getRoleDisplayName(user.role || 'user')}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-2 py-1 text-xs rounded-full ${
                                                    user.blocked
                                                        ? 'bg-red-900 text-red-200'
                                                        : 'bg-green-900 text-green-200'
                                                }`}>
                                                    {user.blocked ? 'Blocked' : 'Active'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <select
                                                    value={user.role || 'user'}
                                                    onChange={(e) => handleRoleChange(user, e.target.value)}
                                                    className="px-3 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                                >
                                                    <option value="user">👤 Utilisateur</option>
                                                    <option value="tester">🧪 Testeur</option>
                                                    <option value="withdrawal_admin">💳 Admin Retraits</option>
                                                    <option value="admin">🛡️ Administrateur</option>
                                                </select>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-4 mt-6">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="px-4 py-2 bg-gray-700 text-white rounded disabled:opacity-50 hover:bg-gray-600"
                        >
                            Previous
                        </button>
                        <span className="text-gray-300">
                            Page {currentPage} of {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="px-4 py-2 bg-gray-700 text-white rounded disabled:opacity-50 hover:bg-gray-600"
                        >
                            Next
                        </button>
                    </div>
                )}
            </main>

            {/* Confirmation Modal */}
            {confirmAction && (
                <ConfirmationModal
                    isOpen={showConfirmModal}
                    title={confirmAction.title}
                    message={confirmAction.message}
                    confirmText="Confirm"
                    cancelText="Cancel"
                    onConfirm={confirmAction.onConfirm}
                    onCancel={() => setShowConfirmModal(false)}
                />
            )}

            {/* Toast Container */}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
};

export default UserRolesManagement;
