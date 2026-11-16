import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Trophy } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import Pagination from '../components/common/Pagination';
import { LeaderboardEntry, apiErrorMessage, getDiffuseurLeaderboard } from '../api/adsNetwork';

const PAGE_SIZE = 50;

const trustColor = (score: number) =>
    score >= 70 ? 'text-green-600 dark:text-green-300' : score >= 40 ? 'text-amber-700 dark:text-amber-300' : 'text-red-600 dark:text-red-300';

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
            <main>
                <motion.div
                    className="bg-surface rounded-xl p-6 border border-line mb-6"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <p className="text-sm text-fg-muted mb-4">
                        La moyenne de vues est <strong>déclarée</strong> tant que le diffuseur n'a pas
                        terminé sa campagne test, <strong>mesurée</strong> ensuite. Les deux sont
                        distinguées ci-dessous : une moyenne déclarée n'engage que celui qui l'a écrite.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                        <select
                            value={sortBy}
                            onChange={(e) => { setSortBy(e.target.value as 'views' | 'clicks' | 'trust'); setPage(1); }}
                            className="px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg text-sm"
                        >
                            <option value="views">Trier par vues</option>
                            <option value="clicks">Trier par clics</option>
                            <option value="trust">Trier par score de confiance</option>
                        </select>
                        <label className="flex items-center gap-2 text-sm text-fg-muted">
                            <input
                                type="checkbox"
                                checked={measuredOnly}
                                onChange={(e) => { setMeasuredOnly(e.target.checked); setPage(1); }}
                                className="rounded-sm bg-surface-2 border-line-strong"
                            />
                            Moyennes mesurées uniquement
                        </label>
                        <button
                            onClick={fetchData}
                            className="flex items-center gap-2 px-4 py-2 bg-surface-2 text-fg rounded-lg hover:bg-surface-3 text-sm"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Actualiser
                        </button>
                        <div className="text-sm text-fg-muted ml-auto">
                            {loading ? 'Chargement…' : `${total} diffuseur${total === 1 ? '' : 's'}`}
                        </div>
                    </div>
                    {error && (
                        <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-3 text-red-800 dark:text-red-200 mt-4">{error}</div>
                    )}
                </motion.div>

                <motion.div
                    className="bg-surface rounded-xl border border-line overflow-hidden"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    {loading ? (
                        <div className="p-12 flex justify-center"><Loader name="Chargement du classement…" /></div>
                    ) : entries.length === 0 ? (
                        <div className="p-12 text-center text-fg-muted">
                            <Trophy className="w-12 h-12 mx-auto mb-3 text-fg-subtle" />
                            <p>Aucun diffuseur inscrit pour le moment.</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-background/50 text-fg-muted">
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
                                    <tr key={e.userId} className="border-t border-line">
                                        <td className="px-4 py-3 text-fg-subtle">{(page - 1) * PAGE_SIZE + i + 1}</td>
                                        <td className="px-4 py-3">
                                            <div className="text-fg">{e.name || e.userId}</div>
                                            <div className="text-xs text-fg-subtle">
                                                {[e.phoneNumber, e.country].filter(Boolean).join(' · ')}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="text-fg">{e.averageViews.toLocaleString('fr-FR')}</span>
                                            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${e.isMeasured ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200' : 'bg-surface-2 text-fg-muted'}`}>
                                                {e.isMeasured ? 'mesurée' : 'déclarée'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-fg">{e.totalVerifiedViews.toLocaleString('fr-FR')}</td>
                                        <td className="px-4 py-3 text-fg">{e.totalClicks.toLocaleString('fr-FR')}</td>
                                        <td className="px-4 py-3 text-fg-muted">{(e.clickThroughRate * 100).toFixed(2)}%</td>
                                        <td className="px-4 py-3 text-fg-muted">{e.campaignsCompleted}</td>
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
