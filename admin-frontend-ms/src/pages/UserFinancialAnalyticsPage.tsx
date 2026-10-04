import { useState, useEffect, useCallback } from 'react';
import Header from '../components/common/Header';
import { getUserFinancialAnalytics, UserAnalyticsEntry, UserAnalyticsFilters } from '../services/adminFinancialAnalyticsApi';
import { getCountryName } from '../utils/countryUtils';
import toast from 'react-hot-toast';
import { Download, Search, TrendingUp, Users, ArrowUpDown } from 'lucide-react';

const COUNTRY_OPTIONS = [
    { value: '', label: 'Tous les pays' },
    { value: 'BJ', label: 'Bénin' },
    { value: 'BF', label: 'Burkina Faso' },
    { value: 'CM', label: 'Cameroun' },
    { value: 'CI', label: "Côte d'Ivoire" },
    { value: 'CD', label: 'RD Congo' },
    { value: 'CG', label: 'Congo-Brazzaville' },
    { value: 'GA', label: 'Gabon' },
    { value: 'GN', label: 'Guinée' },
    { value: 'ML', label: 'Mali' },
    { value: 'NE', label: 'Niger' },
    { value: 'SN', label: 'Sénégal' },
    { value: 'TG', label: 'Togo' },
    { value: 'TD', label: 'Tchad' },
    { value: 'GH', label: 'Ghana' },
    { value: 'KE', label: 'Kenya' },
];

const formatAmount = (amount: number): string => {
    return Math.round(amount).toLocaleString('fr-FR');
};

export default function UserFinancialAnalyticsPage() {
    const [data, setData] = useState<UserAnalyticsEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState<UserAnalyticsFilters>({
        country: '',
        minAmount: 50000,
        page: 1,
        limit: 50,
        sortBy: 'total',
        sortOrder: 'desc',
    });
    const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const cleanFilters = { ...filters };
            if (!cleanFilters.country) delete cleanFilters.country;
            const response = await getUserFinancialAnalytics(cleanFilters);
            if (response.success) {
                setData(response.data);
                setPagination(response.pagination);
            }
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Erreur lors du chargement des données');
        } finally {
            setLoading(false);
        }
    }, [filters]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSort = (field: 'totalWithdrawn' | 'totalEarned' | 'total') => {
        setFilters(prev => ({
            ...prev,
            sortBy: field,
            sortOrder: prev.sortBy === field && prev.sortOrder === 'desc' ? 'asc' : 'desc',
            page: 1,
        }));
    };

    const handleExportCSV = () => {
        if (data.length === 0) {
            toast.error('Aucune donnée à exporter');
            return;
        }

        const headers = ['#', 'Nom', 'Email', 'Téléphone', 'Pays', 'Solde (FCFA)', 'Total Retiré (FCFA)', 'Total Gagné (FCFA)', 'Nb Retraits', 'Nb Gains'];
        const rows = data.map((item, index) => [
            ((filters.page || 1) - 1) * (filters.limit || 50) + index + 1,
            `"${item.name}"`,
            item.email,
            item.phoneNumber,
            item.country,
            Math.round(item.balance),
            Math.round(item.totalWithdrawn),
            Math.round(item.totalEarned),
            item.withdrawalCount,
            item.earningCount,
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(',')),
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.setAttribute('href', URL.createObjectURL(blob));
        const countryLabel = filters.country ? `_${filters.country}` : '_all';
        link.setAttribute('download', `user-analytics${countryLabel}_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success('CSV exporté avec succès');
    };

    const totalWithdrawn = data.reduce((sum, d) => sum + d.totalWithdrawn, 0);
    const totalEarned = data.reduce((sum, d) => sum + d.totalEarned, 0);

    return (
        <div className="p-4 md:p-6">
            <Header title="Analyse Financière Utilisateurs" />

            {/* Filters */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
                <div className="flex flex-wrap gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pays</label>
                        <select
                            value={filters.country || ''}
                            onChange={(e) => setFilters(prev => ({ ...prev, country: e.target.value, page: 1 }))}
                            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        >
                            {COUNTRY_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Montant minimum (FCFA)</label>
                        <input
                            type="number"
                            value={filters.minAmount || 0}
                            onChange={(e) => setFilters(prev => ({ ...prev, minAmount: parseInt(e.target.value) || 0, page: 1 }))}
                            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 w-40"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Par page</label>
                        <select
                            value={filters.limit || 50}
                            onChange={(e) => setFilters(prev => ({ ...prev, limit: parseInt(e.target.value), page: 1 }))}
                            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        >
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                            <option value={200}>200</option>
                        </select>
                    </div>
                    <button
                        onClick={handleExportCSV}
                        disabled={data.length === 0}
                        className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download size={16} />
                        Exporter CSV
                    </button>
                </div>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900 rounded-lg">
                            <Users size={20} className="text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Utilisateurs trouvés</p>
                            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{pagination.total}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
                            <TrendingUp size={20} className="text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Total Retiré (page)</p>
                            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{formatAmount(totalWithdrawn)} FCFA</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900 rounded-lg">
                            <TrendingUp size={20} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Total Gagné (page)</p>
                            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{formatAmount(totalEarned)} FCFA</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                {loading ? (
                    <div className="flex justify-center items-center py-20">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">#</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Utilisateur</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Pays</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Solde</th>
                                    <th
                                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase cursor-pointer hover:text-indigo-600"
                                        onClick={() => handleSort('totalWithdrawn')}
                                    >
                                        <span className="flex items-center gap-1">
                                            Retiré <ArrowUpDown size={12} />
                                        </span>
                                    </th>
                                    <th
                                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase cursor-pointer hover:text-indigo-600"
                                        onClick={() => handleSort('totalEarned')}
                                    >
                                        <span className="flex items-center gap-1">
                                            Gagné <ArrowUpDown size={12} />
                                        </span>
                                    </th>
                                    <th
                                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase cursor-pointer hover:text-indigo-600"
                                        onClick={() => handleSort('total')}
                                    >
                                        <span className="flex items-center gap-1">
                                            Total <ArrowUpDown size={12} />
                                        </span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {data.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                                            Aucun résultat trouvé
                                        </td>
                                    </tr>
                                ) : (
                                    data.map((item, index) => (
                                        <tr key={item.userId} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                            <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                                                {((filters.page || 1) - 1) * (filters.limit || 50) + index + 1}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.name}</div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400">{item.email}</div>
                                                <div className="text-xs text-gray-400 dark:text-gray-500">{item.phoneNumber}</div>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                                                {getCountryName(item.country)}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                                                {formatAmount(item.balance)}
                                            </td>
                                            <td className="px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400">
                                                {formatAmount(item.totalWithdrawn)}
                                            </td>
                                            <td className="px-4 py-3 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                                {formatAmount(item.totalEarned)}
                                            </td>
                                            <td className="px-4 py-3 text-sm font-bold text-gray-900 dark:text-gray-100">
                                                {formatAmount(item.total)}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination */}
                {pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Page {pagination.page} sur {pagination.totalPages} ({pagination.total} résultats)
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setFilters(prev => ({ ...prev, page: (prev.page || 1) - 1 }))}
                                disabled={pagination.page <= 1}
                                className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                                Précédent
                            </button>
                            <button
                                onClick={() => setFilters(prev => ({ ...prev, page: (prev.page || 1) + 1 }))}
                                disabled={pagination.page >= pagination.totalPages}
                                className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                                Suivant
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
