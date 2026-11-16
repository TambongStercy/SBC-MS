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
            toast.error(error.message || 'Impossible de charger les données des partenaires');
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
            toast.error(error.message || 'Impossible de charger les partenaires');
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
            <div className="flex justify-center items-center h-96">
                <Loader name={'Partenaires'} />
            </div>
        );
    }

    return (
        <div>
            <Header title="Partenaires" />

            {/* Summary Stats */}
            <motion.div
                className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <div className="bg-surface p-4 rounded-lg border border-line">
                    <h3 className="text-lg font-medium text-fg">Partenaires actifs</h3>
                    <p className="text-2xl font-bold text-fg">{summaryStats?.totalActivePartners ?? '—'}</p>
                </div>
                <div className="bg-surface p-4 rounded-lg border border-line">
                    <h3 className="text-lg font-medium text-fg">Partenaires Silver actifs</h3>
                    <p className="text-2xl font-bold text-fg">
                        {summaryStats?.activeSilverPartners ?? '—'}
                    </p>
                </div>
                <div className="bg-surface p-4 rounded-lg border border-line">
                    <h3 className="text-lg font-medium text-fg">Partenaires Gold actifs</h3>
                    <p className="text-2xl font-bold text-fg">
                        {summaryStats?.activeGoldPartners ?? '—'}
                    </p>
                </div>
            </motion.div>

            {/* Partners Table */}
            <motion.div
                className="bg-surface rounded-xl border border-line overflow-hidden"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
            >
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-background/70">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Partenaire
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Pack
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Gains
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Statut
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Inscription
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {partners.length > 0 ? (
                                partners.map((partner) => (
                                    <tr key={partner._id} className="hover:bg-surface-2/50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <div className="shrink-0 h-10 w-10">
                                                    <img
                                                        className="h-10 w-10 rounded-full"
                                                        src={partner.user?.avatar ? getAvatarUrl(partner.user.avatar) : `https://ui-avatars.com/api/?name=${encodeURIComponent(partner.user?.name || 'Partenaire')}&background=random`}
                                                        alt={partner.user?.name || 'Partenaire'}
                                                    />
                                                </div>
                                                <div className="ml-4">
                                                    <div className="text-sm font-medium text-fg">
                                                        {partner.user?.name || '—'}
                                                    </div>
                                                    <div className="text-sm text-fg-muted">
                                                        {partner.user?.email || '—'}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                        ${partner.pack === 'gold' ? 'bg-yellow-500/20 text-yellow-800 dark:text-yellow-300' : 'bg-gray-500/20 text-fg-muted'}`}>
                                                {partner.pack.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-fg">
                                            {(partner.amount ?? 0).toLocaleString('fr-FR')} XAF
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                        ${partner.isActive ? 'bg-green-500/20 text-green-700 dark:text-green-300' : 'bg-red-500/20 text-red-700 dark:text-red-300'}`}>
                                                {partner.isActive ? 'Actif' : 'Inactif'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-fg-muted">
                                            {new Date(partner.createdAt).toLocaleDateString('fr-FR')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-fg-muted">
                                            <Link
                                                to={`/userpage/${partner.user?._id}`}
                                                className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                                            >
                                                Voir le détail
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={6} className="px-6 py-4 text-center text-fg-muted">
                                        Aucun partenaire
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="bg-background/50 px-4 py-3 flex items-center justify-between border-t border-line">
                    <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                        <div>
                            <p className="text-sm text-fg-muted">
                                Affichage de <span className="font-medium">{partners.length > 0 ? (pagination.currentPage - 1) * pagination.limit + 1 : 0}</span> à{' '}
                                <span className="font-medium">
                                    {Math.min(pagination.currentPage * pagination.limit, pagination.totalCount)}
                                </span>{' '}
                                sur <span className="font-medium">{pagination.totalCount}</span> résultats
                            </p>
                        </div>
                        <div>
                            <nav className="relative z-0 inline-flex rounded-md -space-x-px" aria-label="Pagination">
                                <button
                                    onClick={() => handlePageChange(pagination.currentPage - 1)}
                                    disabled={pagination.currentPage === 1}
                                    className={`relative inline-flex items-center px-2 py-2 rounded-l-md border border-line bg-surface text-sm font-medium ${pagination.currentPage === 1 ? 'text-fg-subtle cursor-not-allowed' : 'text-fg-muted hover:bg-surface-2'
                                        }`}
                                >
                                    Précédent
                                </button>
                                {/* Page numbers */}
                                {[...Array(pagination.totalPages)].map((_, index) => (
                                    <button
                                        key={index}
                                        onClick={() => handlePageChange(index + 1)}
                                        className={`relative inline-flex items-center px-4 py-2 border ${pagination.currentPage === index + 1
                                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-800/20 text-indigo-700 dark:text-indigo-300'
                                            : 'border-line bg-surface text-fg-muted hover:bg-surface-2'
                                            } text-sm font-medium`}
                                    >
                                        {index + 1}
                                    </button>
                                ))}
                                <button
                                    onClick={() => handlePageChange(pagination.currentPage + 1)}
                                    disabled={pagination.currentPage === pagination.totalPages}
                                    className={`relative inline-flex items-center px-2 py-2 rounded-r-md border border-line bg-surface text-sm font-medium ${pagination.currentPage === pagination.totalPages ? 'text-fg-subtle cursor-not-allowed' : 'text-fg-muted hover:bg-surface-2'
                                        }`}
                                >
                                    Suivant
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