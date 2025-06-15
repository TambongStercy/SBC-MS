import { useState, useEffect } from 'react';
import { motion } from "framer-motion";
import Header from "../components/common/Header";
import { listPartners, PartnerData, PartnerListResponse, getPartnerSummary, PartnerSummaryData } from '../services/adminUserApi';
import Loader from '../components/common/loader';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { getAvatarUrl } from '../api/apiClient';

function Partners() {
    const [partners, setPartners] = useState<PartnerData[]>([]);
    const [loading, setLoading] = useState(true);
    const [summaryStats, setSummaryStats] = useState<PartnerSummaryData | null>(null);
    const [loadingSummary, setLoadingSummary] = useState(true);
    const [pagination, setPagination] = useState({
        currentPage: 1,
        totalPages: 1,
        totalCount: 0,
        limit: 20
    });

    useEffect(() => {
        fetchInitialData();
    }, []);

    const fetchInitialData = async () => {
        setLoading(true);
        setLoadingSummary(true);
        try {
            const [summaryResponse] = await Promise.all([
                getPartnerSummary(),
                fetchPartners(1, 20)
            ]);
            setSummaryStats(summaryResponse);
        } catch (error: any) {
            console.error('Failed to fetch initial partner data:', error);
            toast.error(error.message || 'Failed to load partner data');
        } finally {
            setLoadingSummary(false);
        }
    };

    const fetchPartners = async (page = 1, limit = 20) => {
        setLoading(true);
        try {
            const response = await listPartners({ page, limit });
            setPartners(response.data);
            setPagination(response.pagination);
        } catch (error: any) {
            console.error('Failed to fetch partners:', error);
            toast.error(error.message || 'Failed to load partners');
        } finally {
            setLoading(false);
        }
    };

    const handlePageChange = (newPage: number) => {
        if (newPage > 0 && newPage <= pagination.totalPages) {
            fetchPartners(newPage, pagination.limit);
        }
    };

    if (loadingSummary || loading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader name={'Partners'} />
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto relative z-10 p-4">
            <Header title="Partners Management" />

            {/* Summary Stats */}
            <motion.div
                className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <div className="bg-gray-800 bg-opacity-70 p-4 rounded-lg shadow-lg border border-gray-700">
                    <h3 className="text-lg font-medium text-gray-200">Total Active Partners</h3>
                    <p className="text-2xl font-bold text-white">{summaryStats?.totalActivePartners ?? 'N/A'}</p>
                </div>
                <div className="bg-gray-800 bg-opacity-70 p-4 rounded-lg shadow-lg border border-gray-700">
                    <h3 className="text-lg font-medium text-gray-200">Active Silver Partners</h3>
                    <p className="text-2xl font-bold text-white">
                        {summaryStats?.activeSilverPartners ?? 'N/A'}
                    </p>
                </div>
                <div className="bg-gray-800 bg-opacity-70 p-4 rounded-lg shadow-lg border border-gray-700">
                    <h3 className="text-lg font-medium text-gray-200">Active Gold Partners</h3>
                    <p className="text-2xl font-bold text-white">
                        {summaryStats?.activeGoldPartners ?? 'N/A'}
                    </p>
                </div>
            </motion.div>

            {/* Partners Table */}
            <motion.div
                className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl border border-gray-700 overflow-hidden"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
            >
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-900 bg-opacity-70">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Partner
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Pack
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Earnings
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Joined
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {partners.length > 0 ? (
                                partners.map((partner) => (
                                    <tr key={partner._id} className="hover:bg-gray-700 hover:bg-opacity-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <div className="flex-shrink-0 h-10 w-10">
                                                    <img
                                                        className="h-10 w-10 rounded-full"
                                                        src={partner.user?.avatar ? getAvatarUrl(partner.user.avatar) : `https://ui-avatars.com/api/?name=${encodeURIComponent(partner.user?.name || 'Partner')}&background=random`}
                                                        alt={partner.user?.name || 'Partner'}
                                                    />
                                                </div>
                                                <div className="ml-4">
                                                    <div className="text-sm font-medium text-white">
                                                        {partner.user?.name || 'N/A'}
                                                    </div>
                                                    <div className="text-sm text-gray-400">
                                                        {partner.user?.email || 'N/A'}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                        ${partner.pack === 'gold' ? 'bg-yellow-500 bg-opacity-20 text-yellow-300' : 'bg-gray-500 bg-opacity-20 text-gray-300'}`}>
                                                {partner.pack.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">
                                            {partner.amount} XAF
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                        ${partner.isActive ? 'bg-green-500 bg-opacity-20 text-green-300' : 'bg-red-500 bg-opacity-20 text-red-300'}`}>
                                                {partner.isActive ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                            {new Date(partner.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                            <Link
                                                to={`/userpage/${partner.user?._id}`}
                                                className="text-indigo-400 hover:text-indigo-300 transition-colors"
                                            >
                                                View Details
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={6} className="px-6 py-4 text-center text-gray-400">
                                        No partners found
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="bg-gray-900 bg-opacity-50 px-4 py-3 flex items-center justify-between border-t border-gray-700">
                    <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                        <div>
                            <p className="text-sm text-gray-400">
                                Showing <span className="font-medium">{partners.length > 0 ? (pagination.currentPage - 1) * pagination.limit + 1 : 0}</span> to{' '}
                                <span className="font-medium">
                                    {Math.min(pagination.currentPage * pagination.limit, pagination.totalCount)}
                                </span>{' '}
                                of <span className="font-medium">{pagination.totalCount}</span> results
                            </p>
                        </div>
                        <div>
                            <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                                <button
                                    onClick={() => handlePageChange(pagination.currentPage - 1)}
                                    disabled={pagination.currentPage === 1}
                                    className={`relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-700 bg-gray-800 text-sm font-medium ${pagination.currentPage === 1 ? 'text-gray-500 cursor-not-allowed' : 'text-gray-300 hover:bg-gray-700'
                                        }`}
                                >
                                    Previous
                                </button>
                                {/* Page numbers */}
                                {[...Array(pagination.totalPages)].map((_, index) => (
                                    <button
                                        key={index}
                                        onClick={() => handlePageChange(index + 1)}
                                        className={`relative inline-flex items-center px-4 py-2 border ${pagination.currentPage === index + 1
                                            ? 'border-indigo-500 bg-indigo-800 bg-opacity-20 text-indigo-300'
                                            : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'
                                            } text-sm font-medium`}
                                    >
                                        {index + 1}
                                    </button>
                                ))}
                                <button
                                    onClick={() => handlePageChange(pagination.currentPage + 1)}
                                    disabled={pagination.currentPage === pagination.totalPages}
                                    className={`relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-700 bg-gray-800 text-sm font-medium ${pagination.currentPage === pagination.totalPages ? 'text-gray-500 cursor-not-allowed' : 'text-gray-300 hover:bg-gray-700'
                                        }`}
                                >
                                    Next
                                </button>
                            </nav>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

export default Partners; 