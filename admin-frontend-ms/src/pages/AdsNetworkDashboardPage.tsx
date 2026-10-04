import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
    Megaphone, Users, Eye, MousePointerClick, Wallet, TrendingUp, ShieldAlert, RefreshCw,
} from 'lucide-react';
import {
    Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import StatCard from '../components/common/statCard';
import { AdsAnalytics, apiErrorMessage, formatXaf, getAdsAnalytics } from '../api/adsNetwork';

/** Dashboard for SBC Ads Network. Every number comes from the service; nothing is derived here. */
const AdsNetworkDashboardPage: React.FC = () => {
    const [data, setData] = useState<AdsAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [months, setMonths] = useState(12);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getAdsAnalytics(months)
            .then((res) => { if (!cancelled) { setData(res); setError(null); } })
            .catch((err) => {
                if (!cancelled) setError(apiErrorMessage(err, 'Chargement impossible'));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [months, reloadKey]);

    if (loading && !data) {
        return (
            <div className="flex-1 overflow-auto relative z-10">
                <Header title="SBC Ads Network" />
                <div className="p-12 flex justify-center"><Loader name="Chargement des statistiques…" /></div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto relative z-10">
            <Header title="SBC Ads Network" />
            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                {error && (
                    <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-200 mb-6">{error}</div>
                )}

                {data && data.campaigns.pendingReview > 0 && (
                    <Link
                        to="/ads-network/review"
                        className="flex items-center gap-3 bg-amber-900/30 border border-amber-700 rounded-xl p-4 mb-6 hover:bg-amber-900/50"
                    >
                        <ShieldAlert className="w-5 h-5 text-amber-300 shrink-0" />
                        <span className="text-amber-100 text-sm">
                            <strong>{data.campaigns.pendingReview}</strong> campagne(s) attendent votre validation.
                            Rien n'est diffusé tant qu'elles ne sont pas traitées.
                        </span>
                    </Link>
                )}

                {data && (
                    <>
                        <motion.div
                            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <StatCard
                                name="Annonceurs"
                                icon={Megaphone}
                                color="#6366f1"
                                value={`${data.annonceurs.total} (+${data.annonceurs.newThisMonth} ce mois)`}
                            />
                            <StatCard
                                name="Diffuseurs"
                                icon={Users}
                                color="#10b981"
                                value={`${data.diffuseurs.total} (+${data.diffuseurs.newThisMonth} ce mois)`}
                            />
                            <StatCard
                                name="Campagnes lancées ce mois"
                                icon={TrendingUp}
                                color="#f59e0b"
                                value={data.campaigns.launchedThisMonth}
                            />
                            <StatCard
                                name="Campagnes terminées"
                                icon={TrendingUp}
                                color="#a855f7"
                                value={data.campaigns.completedThisMonth}
                            />
                            <StatCard
                                name="Vues livrées"
                                icon={Eye}
                                color="#38bdf8"
                                value={data.delivery.totalViews.toLocaleString('fr-FR')}
                            />
                            <StatCard
                                name="Clics générés"
                                icon={MousePointerClick}
                                color="#f472b6"
                                value={data.delivery.clicks.toLocaleString('fr-FR')}
                            />
                            <StatCard
                                name="Chiffre d'affaires"
                                icon={Wallet}
                                color="#22c55e"
                                value={formatXaf(data.money.revenue)}
                            />
                            <StatCard
                                name="Versé aux diffuseurs"
                                icon={Wallet}
                                color="#eab308"
                                value={formatXaf(data.money.paidToDiffuseurs)}
                            />
                        </motion.div>

                        <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-gray-400">
                                En cours : {data.pipeline.inProgress} diffusion(s) · {data.pipeline.offered} offre(s) en attente de réponse
                                {' · '}Marge brute {formatXaf(data.money.grossMargin)}
                            </div>
                            <div className="flex items-center gap-2">
                                <select
                                    value={months}
                                    onChange={(e) => setMonths(Number(e.target.value))}
                                    className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                                >
                                    <option value={6}>6 mois</option>
                                    <option value={12}>12 mois</option>
                                    <option value={24}>24 mois</option>
                                </select>
                                <button
                                    onClick={() => setReloadKey((k) => k + 1)}
                                    className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 text-sm"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <motion.div
                                className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                <h3 className="text-lg font-medium text-gray-100 mb-4">Revenus et versements</h3>
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer>
                                        <AreaChart data={data.series}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                            <XAxis dataKey="month" stroke="#9CA3AF" fontSize={12} />
                                            <YAxis stroke="#9CA3AF" fontSize={12} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#1F2937', borderColor: '#4B5563' }}
                                                formatter={(v: number) => formatXaf(v)}
                                            />
                                            <Legend />
                                            <Area name="Chiffre d'affaires" type="monotone" dataKey="revenue" stroke="#22c55e" fill="#22c55e" fillOpacity={0.25} />
                                            <Area name="Versé aux diffuseurs" type="monotone" dataKey="paidToDiffuseurs" stroke="#eab308" fill="#eab308" fillOpacity={0.25} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </motion.div>

                            <motion.div
                                className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                <h3 className="text-lg font-medium text-gray-100 mb-4">Vues et clics livrés</h3>
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer>
                                        <AreaChart data={data.series}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                            <XAxis dataKey="month" stroke="#9CA3AF" fontSize={12} />
                                            <YAxis stroke="#9CA3AF" fontSize={12} />
                                            <Tooltip contentStyle={{ backgroundColor: '#1F2937', borderColor: '#4B5563' }} />
                                            <Legend />
                                            <Area name="Vues" type="monotone" dataKey="views" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.25} />
                                            <Area name="Clics" type="monotone" dataKey="clicks" stroke="#f472b6" fill="#f472b6" fillOpacity={0.25} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </motion.div>

                            <motion.div
                                className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 lg:col-span-2"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                <h3 className="text-lg font-medium text-gray-100 mb-4">Campagnes lancées et nouveaux diffuseurs</h3>
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer>
                                        <BarChart data={data.series}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                            <XAxis dataKey="month" stroke="#9CA3AF" fontSize={12} />
                                            <YAxis stroke="#9CA3AF" fontSize={12} allowDecimals={false} />
                                            <Tooltip contentStyle={{ backgroundColor: '#1F2937', borderColor: '#4B5563' }} />
                                            <Legend />
                                            <Bar name="Campagnes lancées" dataKey="campaignsLaunched" fill="#6366f1" />
                                            <Bar name="Nouveaux diffuseurs" dataKey="newDiffuseurs" fill="#10b981" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </motion.div>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
};

export default AdsNetworkDashboardPage;
