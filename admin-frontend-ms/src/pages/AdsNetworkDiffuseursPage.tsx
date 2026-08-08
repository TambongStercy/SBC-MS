import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Trophy } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import Pagination from '../components/common/Pagination';
import { LeaderboardEntry, apiErrorMessage, getDiffuseurLeaderboard } from '../api/adsNetwork';

const PAGE_SIZE = 50;

const trustColor = (score: number) =>
    score >= 70 ? 'text-green-300' : score >= 40 ? 'text-amber-300' : 'text-red-300';

/** Diffuseur leaderboard: reach, click-through and reliability side by side. */
const AdsNetworkDiffuseursPage: React.FC = () => {
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [sortBy, setSortBy] = useState<'views' | 'clicks' | 'trust'>('views');
    const [measuredOnly, setMeasuredOnly] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            setError(null);
            setLoading(true);
            const res = await getDiffuseurLeaderboard({ page, limit: PAGE_SIZE, sortBy, measuredOnly });
            setEntries(res.entries);
            setTotal(res.total ?? res.entries.length);
        } catch (err) {
            setError(apiErrorMessage(err, 'Impossible de charger le classement'));
        } finally {
            setLoading(false);
        }
    }, [page, sortBy, measuredOnly]);

    useEffect(() => { fetchData(); }, [fetchData]);

    return (
        <div className="flex-1 overflow-auto relative z-10">
            <Header title="SBC Ads Network — Diffuseurs" />
            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                <motion.div
                    className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-6"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <p className="text-sm text-gray-400 mb-4">
                        La moyenne de vues est <strong>déclarée</strong> tant que le diffuseur n'a pas
                        terminé sa campagne test, <strong>mesurée</strong> ensuite. Les deux sont
                        distinguées ci-dessous : une moyenne déclarée n'engage que celui qui l'a écrite.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                        <select
                            value={sortBy}
                            onChange={(e) => { setSortBy(e.target.value as 'views' | 'clicks' | 'trust'); setPage(1); }}
                            className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                        >
                            <option value="views">Trier par vues</option>
                            <option value="clicks">Trier par clics</option>
                            <option value="trust">Trier par score de confiance</option>
                        </select>
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                            <input
                                type="checkbox"
                                checked={measuredOnly}
                                onChange={(e) => { setMeasuredOnly(e.target.checked); setPage(1); }}
                                className="rounded bg-gray-700 border-gray-600"
                            />
                            Moyennes mesurées uniquement
                        </label>
                        <button
                            onClick={fetchData}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 text-sm"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Rafraîchir
                        </button>
                        <div className="text-sm text-gray-400 ml-auto">
                            {loading ? 'Chargement…' : `${total} diffuseur${total === 1 ? '' : 's'}`}
                        </div>
                    </div>
                    {error && (
                        <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-200 mt-4">{error}</div>
                    )}
                </motion.div>

                <motion.div
                    className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl border border-gray-700 overflow-hidden"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    {loading ? (
                        <div className="p-12 flex justify-center"><Loader name="Chargement du classement…" /></div>
                    ) : entries.length === 0 ? (
                        <div className="p-12 text-center text-gray-400">
                            <Trophy className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                            <p>Aucun diffuseur inscrit pour le moment.</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-gray-900/50 text-gray-300">
                                <tr>
                                    <th className="px-4 py-3 text-left">#</th>
                                    <th className="px-4 py-3 text-left">Diffuseur</th>
                                    <th className="px-4 py-3 text-left">Moyenne de vues</th>
                                    <th className="px-4 py-3 text-left">Vues vérifiées</th>
                                    <th className="px-4 py-3 text-left">Clics</th>
                                    <th className="px-4 py-3 text-left">Taux de clic</th>
                                    <th className="px-4 py-3 text-left">Campagnes</th>
                                    <th className="px-4 py-3 text-left">Confiance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((e, i) => (
                                    <tr key={e.userId} className="border-t border-gray-700">
                                        <td className="px-4 py-3 text-gray-500">{(page - 1) * PAGE_SIZE + i + 1}</td>
                                        <td className="px-4 py-3">
                                            <div className="text-white">{e.name || e.userId}</div>
                                            <div className="text-xs text-gray-500">
                                                {[e.phoneNumber, e.country].filter(Boolean).join(' · ')}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="text-gray-100">{e.averageViews.toLocaleString('fr-FR')}</span>
                                            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${e.isMeasured ? 'bg-green-900/40 text-green-200' : 'bg-gray-700 text-gray-400'}`}>
                                                {e.isMeasured ? 'mesurée' : 'déclarée'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-200">{e.totalVerifiedViews.toLocaleString('fr-FR')}</td>
                                        <td className="px-4 py-3 text-gray-200">{e.totalClicks.toLocaleString('fr-FR')}</td>
                                        <td className="px-4 py-3 text-gray-300">{(e.clickThroughRate * 100).toFixed(2)}%</td>
                                        <td className="px-4 py-3 text-gray-300">{e.campaignsCompleted}</td>
                                        <td className={`px-4 py-3 font-medium ${trustColor(e.trustScore)}`}>{e.trustScore}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </motion.div>

                <div className="mt-4">
                    <Pagination
                        currentPage={page}
                        totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
                        onPageChange={setPage}
                    />
                </div>
            </main>
        </div>
    );
};

export default AdsNetworkDiffuseursPage;
