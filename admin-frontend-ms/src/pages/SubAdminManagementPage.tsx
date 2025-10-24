/**
 * Sub-Admin Management Page
 * Allows main admin to create and manage withdrawal sub-admins
 */

import { useState, useEffect } from 'react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import {
    getSubAdmins,
    createSubAdmin,
    updateSubAdmin,
    toggleSubAdminBlock,
    deleteSubAdmin,
    SubAdmin,
    CreateSubAdminData,
    UpdateSubAdminData
} from '../services/subAdminApi';
import { UserPlus, Edit, Lock, Unlock, Trash2, X } from 'lucide-react';

const SubAdminManagementPage = () => {
    const [subAdmins, setSubAdmins] = useState<SubAdmin[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [selectedSubAdmin, setSelectedSubAdmin] = useState<SubAdmin | null>(null);

    // Form states
    const [formData, setFormData] = useState<CreateSubAdminData>({
        name: '',
        email: '',
        password: '',
        phoneNumber: '',
        region: 'Admin',
        country: 'CM'
    });

    const [editFormData, setEditFormData] = useState<UpdateSubAdminData>({});

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    useEffect(() => {
        loadSubAdmins();
    }, [currentPage]);

    const loadSubAdmins = async () => {
        try {
            setLoading(true);
            const response = await getSubAdmins(currentPage, 20);
            setSubAdmins(response.subAdmins);
            setTotalPages(response.pagination.totalPages);
        } catch (error: any) {
            console.error('Error loading sub-admins:', error);
            alert(error.message || 'Failed to load sub-admins');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateSubAdmin = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name || !formData.email || !formData.password || !formData.phoneNumber) {
            alert('Please fill in all required fields');
            return;
        }

        try {
            await createSubAdmin(formData);
            alert('Sub-admin created successfully');
            setShowCreateModal(false);
            setFormData({
                name: '',
                email: '',
                password: '',
                phoneNumber: '',
                region: 'Admin',
                country: 'CM'
            });
            loadSubAdmins();
        } catch (error: any) {
            alert(error.message || 'Failed to create sub-admin');
        }
    };

    const handleUpdateSubAdmin = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!selectedSubAdmin) return;

        try {
            await updateSubAdmin(selectedSubAdmin._id, editFormData);
            alert('Sub-admin updated successfully');
            setShowEditModal(false);
            setSelectedSubAdmin(null);
            setEditFormData({});
            loadSubAdmins();
        } catch (error: any) {
            alert(error.message || 'Failed to update sub-admin');
        }
    };

    const handleToggleBlock = async (subAdmin: SubAdmin) => {
        const action = subAdmin.blocked ? 'unblock' : 'block';
        if (!confirm(`Are you sure you want to ${action} ${subAdmin.name}?`)) return;

        try {
            await toggleSubAdminBlock(subAdmin._id, !subAdmin.blocked);
            alert(`Sub-admin ${action}ed successfully`);
            loadSubAdmins();
        } catch (error: any) {
            alert(error.message || `Failed to ${action} sub-admin`);
        }
    };

    const handleDelete = async (subAdmin: SubAdmin) => {
        if (!confirm(`Are you sure you want to delete ${subAdmin.name}? This action cannot be undone.`)) return;

        try {
            await deleteSubAdmin(subAdmin._id);
            alert('Sub-admin deleted successfully');
            loadSubAdmins();
        } catch (error: any) {
            alert(error.message || 'Failed to delete sub-admin');
        }
    };

    const openEditModal = (subAdmin: SubAdmin) => {
        setSelectedSubAdmin(subAdmin);
        setEditFormData({
            name: subAdmin.name,
            email: subAdmin.email,
            phoneNumber: subAdmin.phoneNumber
        });
        setShowEditModal(true);
    };

    if (loading) {
        return (
            <div className="flex-1 overflow-auto relative z-10 bg-gray-900">
                <Header title="Withdrawal Sub-Admins" />
                <div className="flex items-center justify-center h-96">
                    <Loader name="Sub-Admins" />
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white">
            <Header title="Withdrawal Sub-Admins" />

            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                {/* Header Actions */}
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Sub-Admin Management</h2>
                        <p className="text-gray-400 text-sm mt-1">
                            Manage withdrawal administrators who can approve/reject withdrawal requests
                        </p>
                    </div>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition"
                    >
                        <UserPlus size={20} />
                        Add Sub-Admin
                    </button>
                </div>

                {/* Sub-Admins Table */}
                <div className="bg-gray-800 rounded-lg shadow overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-700">
                        <thead className="bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Email</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Phone</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Created</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-gray-800 divide-y divide-gray-600">
                            {subAdmins.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                                        No sub-admins found. Click "Add Sub-Admin" to create one.
                                    </td>
                                </tr>
                            ) : (
                                subAdmins.map((subAdmin) => (
                                    <tr key={subAdmin._id} className="hover:bg-gray-700">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                                            {subAdmin.name}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                            {subAdmin.email}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                            {subAdmin.phoneNumber}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 text-xs rounded-full ${
                                                subAdmin.blocked
                                                    ? 'bg-red-900 text-red-200'
                                                    : 'bg-green-900 text-green-200'
                                            }`}>
                                                {subAdmin.blocked ? 'Blocked' : 'Active'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                            {new Date(subAdmin.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => openEditModal(subAdmin)}
                                                    className="text-blue-400 hover:text-blue-300"
                                                    title="Edit"
                                                >
                                                    <Edit size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleToggleBlock(subAdmin)}
                                                    className={subAdmin.blocked ? 'text-green-400 hover:text-green-300' : 'text-yellow-400 hover:text-yellow-300'}
                                                    title={subAdmin.blocked ? 'Unblock' : 'Block'}
                                                >
                                                    {subAdmin.blocked ? <Unlock size={18} /> : <Lock size={18} />}
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(subAdmin)}
                                                    className="text-red-400 hover:text-red-300"
                                                    title="Delete"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex justify-center gap-2 mt-6">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="px-4 py-2 bg-gray-700 text-white rounded disabled:opacity-50"
                        >
                            Previous
                        </button>
                        <span className="px-4 py-2 text-gray-300">
                            Page {currentPage} of {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="px-4 py-2 bg-gray-700 text-white rounded disabled:opacity-50"
                        >
                            Next
                        </button>
                    </div>
                )}
            </main>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-800 rounded-lg max-w-md w-full p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-white">Create Sub-Admin</h3>
                            <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateSubAdmin}>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Name*</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Email*</label>
                                    <input
                                        type="email"
                                        required
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Phone Number*</label>
                                    <input
                                        type="tel"
                                        required
                                        placeholder="+237XXXXXXXXX"
                                        value={formData.phoneNumber}
                                        onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Password*</label>
                                    <input
                                        type="password"
                                        required
                                        minLength={6}
                                        value={formData.password}
                                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                                    />
                                    <p className="text-xs text-gray-400 mt-1">Minimum 6 characters</p>
                                </div>

                                <div className="flex gap-3 mt-6">
                                    <button
                                        type="button"
                                        onClick={() => setShowCreateModal(false)}
                                        className="flex-1 px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                    >
                                        Create
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {showEditModal && selectedSubAdmin && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-800 rounded-lg max-w-md w-full p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-white">Edit Sub-Admin</h3>
                            <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleUpdateSubAdmin}>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
                                    <input
                                        type="text"
                                        value={editFormData.name || ''}
                                        onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
                                    <input
                                        type="email"
                                        value={editFormData.email || ''}
                                        onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Phone Number</label>
                                    <input
                                        type="tel"
                                        value={editFormData.phoneNumber || ''}
                                        onChange={(e) => setEditFormData({ ...editFormData, phoneNumber: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">New Password (optional)</label>
                                    <input
                                        type="password"
                                        minLength={6}
                                        value={editFormData.password || ''}
                                        onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                                        placeholder="Leave blank to keep current password"
                                    />
                                </div>

                                <div className="flex gap-3 mt-6">
                                    <button
                                        type="button"
                                        onClick={() => setShowEditModal(false)}
                                        className="flex-1 px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                    >
                                        Update
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SubAdminManagementPage;
