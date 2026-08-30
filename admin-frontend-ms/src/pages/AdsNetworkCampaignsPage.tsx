import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Megaphone, X } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import Pagination from '../components/common/Pagination';
import { getFileUrl } from '../utils/fileUtils';
import {
    AdsCampaign,
    apiErrorMessage,
    CAMPAIGN_STATUS_LABELS,
    CampaignStatus,
    DiffuseurPerformance,
    formatXaf,
    getAdsCampaignPerformance,
    getAdsCampaigns,
} from '../api/adsNetwork';

const PAGE_SIZE = 20;

const STATUS_STYLES: Record<CampaignStatus, string> = {
    draft: 'bg-gray-700 text-gray-300',
    pending_review: 'bg-amber-900/40 text-amber-200',
    approved: 'bg-blue-900/40 text-blue-200',
    rejected: 'bg-red-900/40 text-red-200',
    active: 'bg-green-900/40 text-green-200',
    paused: 'bg-orange-900/40 text-orange-200',
    completed: 'bg-purple-900/40 text-purple-200',
    banked: 'bg-yellow-900/40 text-yellow-200',
    cancelled: 'bg-gray-700 text-gray-400',
};

const ALL_STATUSES = Object.keys(CAMPAIGN_STATUS_LABELS) as CampaignStatus[];

const formatDate = (iso?: string) => (iso ? new Date(iso).toLocaleString('fr-FR') : '—');

/** All campaigns, any status, with the per-diffuseur breakdown behind a click. */
const AdsNetworkCampaignsPage: React.FC = () => {
    const [campaigns, setCampaigns] = useState<AdsCampaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [status, setStatus] = useState<CampaignStatus | ''>('');

    const [detail, setDetail] = useState<{ campaign: AdsCampaign; diffuseurs: DiffuseurPerformance[] } | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            setError(null);
            setLoading(true);
            const res = await getAdsCampaigns({
                page,
                limit: PAGE_SIZE,
                // No status means "pending review only" server-side, so the unfiltered
                // view has to name every status explicitly.
                status: status || ALL_STATUSES,
            });
            setCampaigns(res.campaigns);
            setTotalPages(res.pagination.pages);
            setTotal(res.pagination.total);
        } catch (err) {
            setError(apiErrorMessage(err, 'Impossible de charger les campagnes'));
        } finally {
            setLoading(false);
        }
    }, [page, status]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const openDetail = async (campaign: AdsCampaign) => {
        setDetailLoading(true);
        setDetail({ campaign, diffuseurs: [] });
        try {
            setDetail(await getAdsCampaignPerformance(campaign._id));
        } catch {
            setDetail(null);
        } finally {
            setDetailLoading(false);
        }
    };

    return (
        <div className="flex-1 overflow-auto relative z-10">
            <Header title="SBC Ads Network — Campagnes" />
            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                <motion.div
                    className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-6"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <div className="flex items-center gap-3">
                        <select
                            value={status}
                            onChange={(e) => { setStatus(e.target.value as CampaignStatus | ''); setPage(1); }}
                            className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                        >
                            <option value="">Tous les statuts</option>
                            {ALL_STATUSES.map((s) => (
                                <option key={s} value={s}>{CAMPAIGN_STATUS_LABELS[s]}</option>
                            ))}
                        </select>
                        <button
                            onClick={fetchData}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 text-sm"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Rafraîchir
                        </button>
                        <div className="text-sm text-gray-400 ml-auto">
                            {loading ? 'Chargement…' : `${total} campagne${total === 1 ? '' : 's'}`}
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
                        <div className="p-12 flex justify-center"><Loader name="Chargement des campagnes…" /></div>
                    ) : campaigns.length === 0 ? (
                        <div className="p-12 text-center text-gray-400">
                            <Megaphone className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                            <p>Aucune campagne pour ce filtre.</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-gray-900/50 text-gray-300">
                                <tr>
                                    <th className="px-4 py-3 text-left">Campagne</th>
                                    <th className="px-4 py-3 text-left">Annonceur</th>
                                    <th className="px-4 py-3 text-left">Statut</th>
                                    <th className="px-4 py-3 text-left">Budget</th>
                                    <th className="px-4 py-3 text-left">Progression</th>
                                    <th className="px-4 py-3 text-left">Clics</th>
                                    <th className="px-4 py-3 text-left">Créée</th>
                                </tr>
                            </thead>
                            <tbody>
                                {campaigns.map((c) => (
                                    <tr
                                        key={c._id}
                                        onClick={() => openDetail(c)}
                                        className="border-t border-gray-700 hover:bg-gray-700/40 cursor-pointer"
                                    >
                                        <td className="px-4 py-3 text-white">{c.title}</td>
                                        <td className="px-4 py-3 text-gray-300">{c.advertiser?.name || '—'}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 rounded-full text-xs ${STATUS_STYLES[c.status]}`}>
                                                {CAMPAIGN_STATUS_LABELS[c.status]}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-200 font-mono">{formatXaf(c.amountPaid)}</td>
                                        <td className="px-4 py-3 text-gray-300">
                                            {c.progress.uniqueViewsDelivered.toLocaleString('fr-FR')} / {c.progress.targetUniqueViews.toLocaleString('fr-FR')}
                                            <span className="text-gray-500 text-xs ml-1">({c.progress.percentComplete}%)</span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-300">{c.clicksTotal.toLocaleString('fr-FR')}</td>
                                        <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(c.createdAt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </motion.div>

                <div className="mt-4">
                    <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
                </div>
            </main>

            {detail && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-start z-50 p-4 overflow-auto">
                    <div className="bg-gray-800 rounded-xl shadow-xl w-full max-w-5xl my-8 border border-gray-700">
                        <div className="flex items-start justify-between p-6 border-b border-gray-700">
                            <div>
                                <h2 className="text-xl font-semibold text-white">{detail.campaign.title}</h2>
                                <p className="text-sm text-gray-400 mt-1">
                                    {detail.campaign.advertiser?.name || 'Annonceur inconnu'} ·{' '}
                                    {CAMPAIGN_STATUS_LABELS[detail.campaign.status]} ·{' '}
                                    {formatXaf(detail.campaign.amountPaid)}
                                </p>
                            </div>
                            <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-white">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6">
                            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
                                {detail.campaign.mediaType === 'video' ? (
                                    <video src={getFileUrl(detail.campaign.mediaFileId)} controls className="w-full rounded-lg bg-black" />
                                ) : (
                                    <img src={getFileUrl(detail.campaign.mediaFileId)} alt={detail.campaign.title} className="w-full rounded-lg object-contain bg-black" />
                                )}
                                <div className="grid grid-cols-2 gap-4 text-sm content-start">
                                    <div>
                                        <div className="text-gray-500 text-xs">Vues uniques (facturées)</div>
                                        <div className="text-gray-100">
                                            {detail.campaign.progress.uniqueViewsDelivered.toLocaleString('fr-FR')} / {detail.campaign.progress.targetUniqueViews.toLocaleString('fr-FR')}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 text-xs">Vues répétées (offertes)</div>
                                        <div className="text-gray-100">{detail.campaign.progress.repeatViewsDelivered.toLocaleString('fr-FR')}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 text-xs">Activée le</div>
                                        <div className="text-gray-100">{formatDate(detail.campaign.activatedAt)}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500 text-xs">Terminée le</div>
                                        <div className="text-gray-100">{formatDate(detail.campaign.completedAt)}</div>
                                    </div>
                                    {detail.campaign.rejectionReason && (
                                        <div className="col-span-2">
                                            <div className="text-gray-500 text-xs">Motif de refus</div>
                                            <div className="text-red-200">{detail.campaign.rejectionReason}</div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <h3 className="text-lg font-medium text-gray-100 mt-8 mb-3">Performance par diffuseur</h3>
                            {detailLoading ? (
                                <div className="p-8 flex justify-center"><Loader name="Chargement…" /></div>
                            ) : detail.diffuseurs.length === 0 ? (
                                <p className="text-gray-400 text-sm">Aucun diffuseur n'a encore accepté cette campagne.</p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-900/50 text-gray-300">
                                        <tr>
                                            <th className="px-3 py-2 text-left">Diffuseur</th>
                                            <th className="px-3 py-2 text-left">Statut</th>
                                            <th className="px-3 py-2 text-left">Vues J1</th>
                                            <th className="px-3 py-2 text-left">Vues totales</th>
                                            <th className="px-3 py-2 text-left">Clics</th>
                                            <th className="px-3 py-2 text-left">Taux de clic</th>
                                            <th className="px-3 py-2 text-left">Gains</th>
                                            <th className="px-3 py-2 text-left">Payé le</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detail.diffuseurs.map((d) => (
                                            <tr key={d.diffuseurUserId} className="border-t border-gray-700">
                                                <td className="px-3 py-2 text-white">
                                                    {d.name || d.diffuseurUserId}
                                                    {d.phoneNumber && <div className="text-xs text-gray-500">{d.phoneNumber}</div>}
                                                </td>
                                                <td className="px-3 py-2 text-gray-300">{d.status}</td>
                                                <td className="px-3 py-2 text-gray-200">{d.uniqueViews.toLocaleString('fr-FR')}</td>
                                                <td className="px-3 py-2 text-gray-200">{d.totalViews.toLocaleString('fr-FR')}</td>
                                                <td className="px-3 py-2 text-gray-200">{d.clicks.toLocaleString('fr-FR')}</td>
                                                <td className="px-3 py-2 text-gray-300">{(d.clickThroughRate * 100).toFixed(2)}%</td>
                                                <td className="px-3 py-2 text-gray-200 font-mono">{formatXaf(d.earned)}</td>
                                                <td className="px-3 py-2 text-gray-400 text-xs">{formatDate(d.paidAt ?? undefined)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdsNetworkCampaignsPage;
