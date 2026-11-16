import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, ShieldCheck, AlertTriangle, ExternalLink } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import Pagination from '../components/common/Pagination';
import ToastContainer from '../components/common/ToastContainer';
import ConfirmationModal from '../components/common/ConfirmationModal';
import { useToast } from '../hooks/useToast';
import { getFileUrl } from '../utils/fileUtils';
import MediaChangeQueue from '../components/adsNetwork/MediaChangeQueue';
import {
    AdsCampaign,
    apiErrorMessage,
    approveAdsCampaign,
    formatXaf,
    getAdsCampaigns,
    rejectAdsCampaign,
} from '../api/adsNetwork';

/**
 * Moderation queue for SBC Ads Network.
 *
 * An approved creative is published to thousands of people's personal WhatsApp
 * statuses under the diffuseur's own name. This page is the only thing standing
 * between an annonceur's upload and that, which is why the creative is shown at
 * full size and rejection demands a written reason.
 */
const PAGE_SIZE = 10;

const targetingSummary = (c: AdsCampaign): string => {
    const t = c.targeting || {};
    const bits: string[] = [];
    if (t.countries?.length) bits.push(t.countries.join(', '));
    if (t.regions?.length) bits.push(t.regions.join(', '));
    if (t.cities?.length) bits.push(t.cities.join(', '));
    if (t.sex?.length) bits.push(t.sex.join('/'));
    if (t.minAge || t.maxAge) bits.push(`${t.minAge ?? '?'}–${t.maxAge ?? '?'} ans`);
    if (t.interests?.length) bits.push(t.interests.join(', '));
    if (t.professions?.length) bits.push(t.professions.join(', '));
    if (t.languages?.length) bits.push(t.languages.join(', '));
    return bits.length ? bits.join(' · ') : 'Aucun ciblage — proposée à tous les diffuseurs';
};

/**
 * The annonceur's photo, or their initials.
 *
 * An avatar is often missing and the URL can fail, so both fall back to initials
 * rather than to a broken image icon — the point is telling accounts apart at a
 * glance while reviewing.
 */
const AnnonceurAvatar: React.FC<{ avatar?: string; name?: string }> = ({ avatar, name }) => {
    const [failed, setFailed] = useState(false);
    const initials = (name ?? '?')
        .split(' ')
        .map(part => part.trim()[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase() || '?';

    if (!avatar || failed) {
        return (
            <div className="w-11 h-11 rounded-full shrink-0 bg-surface-2 grid place-items-center text-sm font-semibold text-fg-muted">
                {initials}
            </div>
        );
    }

    return (
        <img
            src={getFileUrl(avatar)}
            alt=""
            onError={() => setFailed(true)}
            className="w-11 h-11 rounded-full shrink-0 object-cover bg-surface-2"
        />
    );
};

const AdsNetworkReviewPage: React.FC = () => {
    const { toasts, removeToast, showSuccess, showError } = useToast();

    const [campaigns, setCampaigns] = useState<AdsCampaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [actingOn, setActingOn] = useState<string | null>(null);

    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [confirmApprove, setConfirmApprove] = useState<AdsCampaign | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setError(null);
            setLoading(true);
            const res = await getAdsCampaigns({ page, limit: PAGE_SIZE });
            setCampaigns(res.campaigns);
            setTotalPages(res.pagination.pages);
            setTotal(res.pagination.total);
        } catch (err) {
            setError(apiErrorMessage(err, 'Impossible de charger la file de validation'));
        } finally {
            setLoading(false);
        }
    }, [page]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleApprove = async (campaign: AdsCampaign) => {
        setActingOn(campaign._id);
        try {
            await approveAdsCampaign(campaign._id);
            showSuccess(`« ${campaign.title} » validée. L'annonceur peut maintenant payer.`);
            await fetchData();
        } catch (err) {
            showError(apiErrorMessage(err, 'La validation a échoué.'));
        } finally {
            setActingOn(null);
            setConfirmApprove(null);
        }
    };

    const handleReject = async (campaign: AdsCampaign) => {
        const reason = rejectReason.trim();
        if (!reason) {
            showError('Indiquez un motif : sans lui l\'annonceur ne peut rien corriger.');
            return;
        }
        setActingOn(campaign._id);
        try {
            await rejectAdsCampaign(campaign._id, reason);
            showSuccess(`« ${campaign.title} » refusée. Le motif a été envoyé à l'annonceur.`);
            setRejectingId(null);
            setRejectReason('');
            await fetchData();
        } catch (err) {
            showError(apiErrorMessage(err, 'Le refus a échoué.'));
        } finally {
            setActingOn(null);
        }
    };

    return (
        <div className="flex-1 overflow-auto relative z-10">
            <Header title="SBC Ads Network — Validation des campagnes" />
            <main>
                <MediaChangeQueue showSuccess={showSuccess} showError={showError} />
                <motion.div
                    className="bg-surface rounded-xl p-6 border border-line mb-6"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-4 mb-4">
                        <p className="text-sm text-amber-800 dark:text-amber-100">
                            <strong>Ce que vous validez.</strong> Une campagne approuvée est publiée
                            sur le statut WhatsApp personnel de centaines de diffuseurs, sous leur
                            propre nom. Vérifiez la créative, la légende et les coordonnées de contact
                            avant d'approuver. Une campagne refusée doit l'être avec un motif : c'est
                            la seule information dont l'annonceur dispose pour corriger.
                        </p>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="text-sm text-fg-muted">
                            {loading
                                ? 'Chargement…'
                                : `${total} campagne${total === 1 ? '' : 's'} en attente de validation`}
                        </div>
                        <button
                            onClick={fetchData}
                            className="flex items-center gap-2 px-4 py-2 bg-surface-2 text-fg rounded-lg hover:bg-surface-3"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Actualiser
                        </button>
                    </div>

                    {error && (
                        <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-3 text-red-800 dark:text-red-200 mt-4">{error}</div>
                    )}
                </motion.div>

                {loading ? (
                    <div className="p-12 flex justify-center"><Loader name="Chargement des campagnes…" /></div>
                ) : campaigns.length === 0 ? (
                    <div className="bg-surface rounded-xl border border-line p-12 text-center text-fg-muted">
                        <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-fg-subtle" />
                        <p>Aucune campagne en attente.</p>
                        <p className="text-xs mt-2">Les campagnes soumises par les annonceurs apparaîtront ici.</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {campaigns.map((c) => {
                            const isActing = actingOn === c._id;
                            return (
                                <motion.div
                                    key={c._id}
                                    className="bg-surface rounded-xl border border-line overflow-hidden"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                >
                                    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 p-6">
                                        <div>
                                            {c.mediaType === 'video' ? (
                                                <video
                                                    src={getFileUrl(c.mediaFileId)}
                                                    controls
                                                    className="w-full rounded-lg bg-black max-h-96"
                                                />
                                            ) : (
                                                <img
                                                    src={getFileUrl(c.mediaFileId)}
                                                    alt={c.title}
                                                    className="w-full rounded-lg object-contain bg-black max-h-96"
                                                />
                                            )}
                                            <a
                                                href={c.previewUrl ?? c.landingPageUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="mt-3 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200"
                                            >
                                                <ExternalLink className="w-3 h-3" />
                                                Voir la page d'atterrissage
                                            </a>
                                        </div>

                                        <div>
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex items-start gap-3 min-w-0">
                                                    <AnnonceurAvatar
                                                        avatar={c.advertiser?.avatar}
                                                        name={c.advertiser?.name}
                                                    />
                                                    <div className="min-w-0">
                                                        <h3 className="text-xl font-semibold text-fg">{c.title}</h3>
                                                        <p className="text-sm text-fg-muted mt-1 wrap-break-word">
                                                            {c.advertiser?.name || 'Annonceur inconnu'}
                                                            {c.advertiser?.phoneNumber ? ` · ${c.advertiser.phoneNumber}` : ''}
                                                            {c.advertiser?.email ? ` · ${c.advertiser.email}` : ''}
                                                        </p>
                                                    </div>
                                                </div>
                                                {c.isFirstCampaign ? (
                                                    <span className="flex items-center gap-1 shrink-0 px-3 py-1 rounded-full text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                                                        <AlertTriangle className="w-3 h-3" />
                                                        Première campagne
                                                    </span>
                                                ) : (
                                                    <span className="shrink-0 px-3 py-1 rounded-full text-xs bg-surface-2 text-fg-muted">
                                                        {c.priorApprovedCampaigns} campagne(s) déjà validée(s)
                                                    </span>
                                                )}
                                            </div>

                                            {c.description && (
                                                <p className="text-sm text-fg-muted mt-3 whitespace-pre-wrap">{c.description}</p>
                                            )}

                                            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                                                <div>
                                                    <div className="text-fg-subtle text-xs">Budget</div>
                                                    <div className="text-fg">{formatXaf(c.amountPaid)}</div>
                                                </div>
                                                <div>
                                                    <div className="text-fg-subtle text-xs">Vues uniques visées</div>
                                                    <div className="text-fg">{c.targetUniqueViews.toLocaleString('fr-FR')}</div>
                                                </div>
                                                <div className="col-span-2">
                                                    <div className="text-fg-subtle text-xs">Ciblage</div>
                                                    <div className="text-fg">{targetingSummary(c)}</div>
                                                </div>
                                                {/* Whether this targeting can actually deliver what was
                                                    bought. Rufus: an admin must see the shortfall BEFORE
                                                    approving, so they can tell the annonceur to widen it
                                                    instead of validating a campaign that will sit at zero. */}
                                                <div className="col-span-2">
                                                    <div className="text-fg-subtle text-xs">Audience disponible</div>
                                                    {c.reach === null ? (
                                                        <div className="text-fg-muted">Inconnue — l'estimation a échoué</div>
                                                    ) : c.reach.matching === 0 ? (
                                                        <div className="rounded-md bg-red-500/10 border border-red-500/40 px-2 py-1.5 text-red-700 dark:text-red-300">
                                                            Aucun diffuseur ne correspond à ce ciblage. La campagne ne
                                                            pourra être proposée à personne — demandez à l'annonceur
                                                            d'élargir ses critères avant de valider.
                                                        </div>
                                                    ) : c.reach.sufficient === false ? (
                                                        <div className="rounded-md bg-amber-500/10 border border-amber-500/40 px-2 py-1.5 text-amber-800 dark:text-amber-300">
                                                            {c.reach.matching} diffuseur(s), soit environ{' '}
                                                            {c.reach.projectedUniqueViews.toLocaleString('fr-FR')} vues —
                                                            insuffisant pour les {c.targetUniqueViews.toLocaleString('fr-FR')}{' '}
                                                            vues achetées. Demandez-lui d'élargir le ciblage.
                                                        </div>
                                                    ) : (
                                                        <div className="text-green-600 dark:text-green-300">
                                                            {c.reach.matching} diffuseur(s), soit environ{' '}
                                                            {c.reach.projectedUniqueViews.toLocaleString('fr-FR')} vues
                                                            disponibles.
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="col-span-2">
                                                    <div className="text-fg-subtle text-xs">Contact affiché aux prospects</div>
                                                    <div className="text-fg">
                                                        {[c.contactWhatsapp && `WhatsApp ${c.contactWhatsapp}`,
                                                        c.contactPhone && `Tél ${c.contactPhone}`,
                                                        c.websiteUrl].filter(Boolean).join(' · ') || '—'}
                                                    </div>
                                                </div>
                                            </div>

                                            {c.suggestedCaption && (
                                                <div className="mt-4">
                                                    <div className="text-fg-subtle text-xs mb-1">
                                                        Légende proposée aux diffuseurs (le lien de suivi y sera ajouté)
                                                    </div>
                                                    <div className="bg-background/60 border border-line rounded-lg p-3 text-sm text-fg whitespace-pre-wrap">
                                                        {c.suggestedCaption}
                                                    </div>
                                                </div>
                                            )}

                                            {rejectingId === c._id ? (
                                                <div className="mt-5">
                                                    <textarea
                                                        value={rejectReason}
                                                        onChange={(e) => setRejectReason(e.target.value)}
                                                        rows={3}
                                                        autoFocus
                                                        placeholder="Motif du refus — il est envoyé tel quel à l'annonceur. Soyez précis sur ce qu'il doit corriger."
                                                        className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg placeholder-fg-subtle focus:ring-2 focus:ring-red-500 focus:border-transparent"
                                                    />
                                                    <div className="flex gap-2 mt-2">
                                                        <button
                                                            onClick={() => handleReject(c)}
                                                            disabled={isActing || !rejectReason.trim()}
                                                            className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed"
                                                        >
                                                            {isActing ? 'Envoi…' : 'Confirmer le refus'}
                                                        </button>
                                                        <button
                                                            onClick={() => { setRejectingId(null); setRejectReason(''); }}
                                                            className="px-4 py-2 text-sm bg-surface-2 text-fg rounded-lg hover:bg-surface-3"
                                                        >
                                                            Annuler
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex gap-2 mt-5">
                                                    <button
                                                        onClick={() => setConfirmApprove(c)}
                                                        disabled={isActing}
                                                        className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600"
                                                    >
                                                        {isActing ? 'Traitement…' : 'Approuver'}
                                                    </button>
                                                    <button
                                                        onClick={() => { setRejectingId(c._id); setRejectReason(''); }}
                                                        disabled={isActing}
                                                        className="px-4 py-2 text-sm bg-surface-2 text-fg rounded-lg hover:bg-surface-3 disabled:opacity-50"
                                                    >
                                                        Refuser
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}

                        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
                    </div>
                )}
            </main>

            {confirmApprove && (
                <ConfirmationModal
                    isOpen
                    title="Approuver cette campagne ?"
                    message={`« ${confirmApprove.title} » pourra être payée puis diffusée sur le statut WhatsApp personnel des diffuseurs. Confirmez-vous avoir vérifié la créative et la légende ?`}
                    confirmText="Approuver"
                    cancelText="Annuler"
                    onConfirm={() => handleApprove(confirmApprove)}
                    onCancel={() => setConfirmApprove(null)}
                />
            )}

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
};

export default AdsNetworkReviewPage;
