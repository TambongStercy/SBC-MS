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
import { Search, Filter } from 'lucide-react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Shield01Icon, CreditCardIcon, TestTube01Icon, UserIcon } from '@hugeicons/core-free-icons';

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
            showError(error.message || 'Impossible de charger les utilisateurs');
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
            title: isElevatingToAdmin ? 'Confirmer le changement de rôle' : 'Changer le rôle',
            message: isElevatingToAdmin
                ? `Vous allez donner le rôle ${getRoleDisplayName(newRole)} à ${user.name}, avec un accès d’administration. Confirmer ?`
                : `Passer ${user.name} au rôle ${getRoleDisplayName(newRole)} ?`,
            onConfirm: async () => {
                try {
                    await updateUserRole(user._id, newRole);
                    showSuccess(`${user.name} a maintenant le rôle ${getRoleDisplayName(newRole)}`);
                    loadUsers();
                } catch (error: any) {
                    showError(error.message || 'Échec de la mise à jour du rôle');
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
                return 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-500';
            case 'withdrawal_admin':
                return 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-500';
            case 'tester':
                return 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 border-purple-500';
            default:
                return 'bg-surface-2 text-fg-muted border-line-strong';
        }
    };

    const getRoleIcon = (role: string): IconSvgElement => {
        switch (role) {
            case 'admin':
                return Shield01Icon;
            case 'withdrawal_admin':
                return CreditCardIcon;
            case 'tester':
                return TestTube01Icon;
            default:
                return UserIcon;
        }
    };

    if (loading && users.length === 0) {
        return (
            <div>
                <Header title="Rôles des utilisateurs" />
                <div className="flex items-center justify-center h-96">
                    <Loader name="Utilisateurs" />
                </div>
            </div>
        );
    }

    return (
        <div className="text-fg">
            <Header title="Rôles des utilisateurs" name="Gérez les rôles et les droits des utilisateurs de la plateforme" />

            <main>

                {/* Filters */}
                <div className="bg-surface border border-line rounded-lg p-4 mb-6">
                    <div className="flex flex-col lg:flex-row gap-4">
                        {/* Search */}
                        <div className="flex-1">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-fg-muted" size={20} />
                                <input
                                    type="text"
                                    placeholder="Rechercher par nom, e-mail ou téléphone"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                                    className="w-full pl-10 pr-4 py-2 bg-surface border border-line-strong rounded-lg text-fg placeholder-fg-subtle focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
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
                                className="w-full px-4 py-2 bg-surface border border-line-strong rounded-lg text-fg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="">Tous les rôles</option>
                                <option value="user">Utilisateur</option>
                                <option value="tester">Testeur</option>
                                <option value="withdrawal_admin">Admin Retraits</option>
                                <option value="admin">Administrateur</option>
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
                                className="w-full px-4 py-2 bg-surface border border-line-strong rounded-lg text-fg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="">Tous les statuts</option>
                                <option value="active">Actif</option>
                                <option value="blocked">Bloqué</option>
                            </select>
                        </div>

                        {/* Search Button */}
                        <button
                            onClick={handleSearch}
                            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition flex items-center gap-2"
                        >
                            <Filter size={18} />
                            Rechercher
                        </button>
                    </div>
                </div>

                {/* Results Count */}
                <div className="mb-4 text-sm text-fg-muted">
                    {users.length} sur {totalCount} utilisateurs
                </div>

                {/* Users Table */}
                <div className="bg-surface border border-line rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-line">
                            <thead className="bg-surface-2">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Utilisateur</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Contact</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Rôle actuel</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Statut</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Changer le rôle</th>
                                </tr>
                            </thead>
                            <tbody className="bg-surface divide-y divide-line">
                                {users.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-fg-muted">
                                            Aucun utilisateur trouvé. Modifiez les filtres.
                                        </td>
                                    </tr>
                                ) : (
                                    users.map((user) => (
                                        <tr key={user._id} className="hover:bg-surface-2">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center">
                                                    <div className="shrink-0 h-10 w-10">
                                                        <div className="h-10 w-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold">
                                                            {user.name.charAt(0).toUpperCase()}
                                                        </div>
                                                    </div>
                                                    <div className="ml-4">
                                                        <div className="text-sm font-medium text-fg">{user.name}</div>
                                                        <div className="text-sm text-fg-muted">{user.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-fg-muted">
                                                <div>{user.phoneNumber || '—'}</div>
                                                <div className="text-xs text-fg-muted">{user.country || '—'}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full border ${getRoleBadgeColor(user.role || 'user')}`}>
                                                    <HugeiconsIcon icon={getRoleIcon(user.role || 'user')} size={14} />
                                                    {getRoleDisplayName(user.role || 'user')}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-2 py-1 text-xs rounded-full ${
                                                    user.blocked
                                                        ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                                                        : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                                                }`}>
                                                    {user.blocked ? 'Bloqué' : 'Actif'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <select
                                                    value={user.role || 'user'}
                                                    onChange={(e) => handleRoleChange(user, e.target.value)}
                                                    className="px-3 py-1 bg-surface border border-line-strong rounded-sm text-sm text-fg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                                                >
                                                    <option value="user">Utilisateur</option>
                                                    <option value="tester">Testeur</option>
                                                    <option value="withdrawal_admin">Admin Retraits</option>
                                                    <option value="admin">Administrateur</option>
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
                            className="px-4 py-2 bg-surface-2 text-fg rounded-sm disabled:opacity-50 hover:bg-surface-3"
                        >
                            Précédent
                        </button>
                        <span className="text-fg-muted">
                            Page {currentPage} sur {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="px-4 py-2 bg-surface-2 text-fg rounded-sm disabled:opacity-50 hover:bg-surface-3"
                        >
                            Suivant
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
                    confirmText="Confirmer"
                    cancelText="Annuler"
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
