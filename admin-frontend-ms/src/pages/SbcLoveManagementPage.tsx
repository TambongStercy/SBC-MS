import { useState, useEffect, useCallback } from 'react';
import Header from '../components/common/Header';
import Pagination from '../components/common/Pagination';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import ProfileReviewModal from '../components/sbclove/ProfileReviewModal';
import {
    listMembers,
    getStats,
    listProfiles,
    validateProfile,
    setSuspension,
    listReports,
    reviewReport,
    getModuleConfig,
    updateModuleConfig,
    handleError,
    ProfileStatus,
    ReportStatus,
    type LoveProfile,
    type MemberRow,
    type SbcLoveStats,
    type Report,
    type ModuleConfig,
} from '../services/adminSbcLoveApi';

type Tab = 'members' | 'profiles' | 'reports' | 'config';

const INTENTION_LABELS: Record<string, string> = {
    relation_serieuse: 'Relation sérieuse',
    faire_connaissance: 'Faire connaissance',
    projet_mariage: 'Projet de mariage',
    elargir_cercle_social: 'Élargir cercle social',
    echange_valeurs_respect: 'Échange valeurs & respect',
    autre: 'Autre',
};

const WEEKDAY_LABELS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function statusBadge(status: string) {
    const map: Record<string, string> = {
        pending: 'bg-yellow-700 text-yellow-100',
        approved: 'bg-green-700 text-green-100',
        rejected: 'bg-red-700 text-red-100',
        suspended: 'bg-gray-600 text-gray-200',
        open: 'bg-yellow-700 text-yellow-100',
        reviewed: 'bg-blue-700 text-blue-100',
        dismissed: 'bg-gray-600 text-gray-200',
    };
    return `px-2 py-0.5 inline-flex text-xs font-semibold rounded-full ${map[status] ?? 'bg-gray-700 text-gray-200'}`;
}

// ─── Profiles Tab ────────────────────────────────────────────────────────────

function ProfilesTab() {
    const { toasts, removeToast, showSuccess, showError } = useToast();
    const [profiles, setProfiles] = useState<LoveProfile[]>([]);
    const [statusFilter, setStatusFilter] = useState<ProfileStatus | ''>('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [isLoading, setIsLoading] = useState(true);

    const [confirmModal, setConfirmModal] = useState<{
        title: string;
        message: string;
        onConfirm: () => Promise<void>;
    } | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmLoading, setConfirmLoading] = useState(false);

    // Reject modal state
    const [rejectModalOpen, setRejectModalOpen] = useState(false);
    const [rejectTarget, setRejectTarget] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    // The profile under review. Validating from the table alone is guesswork —
    // the decision needs the photos and the description, which live in here.
    const [reviewing, setReviewing] = useState<LoveProfile | null>(null);
    const [reviewBusy, setReviewBusy] = useState(false);

    const fetchProfiles = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await listProfiles({
                status: statusFilter || undefined,
                page,
                limit: 15,
            });
            setProfiles(res.data);
            setTotalPages(res.pagination.totalPages);
        } catch (err) {
            showError(handleError(err));
            setProfiles([]);
        } finally {
            setIsLoading(false);
        }
    }, [statusFilter, page]);

    useEffect(() => { fetchProfiles(); }, [fetchProfiles]);
    useEffect(() => { setPage(1); }, [statusFilter]);

    function openConfirm(title: string, message: string, action: () => Promise<void>) {
        setConfirmModal({ title, message, onConfirm: action });
        setConfirmOpen(true);
    }

    async function handleConfirm() {
        if (!confirmModal) return;
        setConfirmLoading(true);
        try {
            await confirmModal.onConfirm();
        } finally {
            setConfirmLoading(false);
            setConfirmOpen(false);
            setConfirmModal(null);
        }
    }

    function handleApprove(profile: LoveProfile) {
        openConfirm(
            'Approuver le profil',
            `Approuver le profil de "${profile.displayName || profile.userId}" ?`,
            async () => {
                await validateProfile(profile._id, true);
                showSuccess('Profil approuvé');
                fetchProfiles();
            }
        );
    }

    function openReject(profile: LoveProfile) {
        setRejectTarget(profile._id);
        setRejectReason('');
        setRejectModalOpen(true);
    }

    async function reviewApprove(profile: LoveProfile) {
        setReviewBusy(true);
        try {
            await validateProfile(profile._id, true);
            showSuccess('Profil approuvé');
            setReviewing(null);
            fetchProfiles();
        } catch (err) {
            showError(handleError(err));
        } finally {
            setReviewBusy(false);
        }
    }

    async function reviewReject(profile: LoveProfile, reason: string) {
        setReviewBusy(true);
        try {
            await validateProfile(profile._id, false, reason || undefined);
            showSuccess('Profil rejeté');
            setReviewing(null);
            fetchProfiles();
        } catch (err) {
            showError(handleError(err));
        } finally {
            setReviewBusy(false);
        }
    }

    async function handleRejectSubmit() {
        if (!rejectTarget) return;
        try {
            await validateProfile(rejectTarget, false, rejectReason || undefined);
            showSuccess('Profil rejeté');
            setRejectModalOpen(false);
            setRejectTarget(null);
            fetchProfiles();
        } catch (err) {
            showError(handleError(err));
        }
    }

    function handleSuspend(profile: LoveProfile) {
        const isSuspended = profile.status === ProfileStatus.SUSPENDED;
        openConfirm(
            isSuspended ? 'Réintégrer le profil' : 'Suspendre le profil',
            isSuspended
                ? `Réintégrer le profil de "${profile.displayName || profile.userId}" ?`
                : `Suspendre le profil de "${profile.displayName || profile.userId}" ?`,
            async () => {
                await setSuspension(profile._id, !isSuspended);
                showSuccess(isSuspended ? 'Profil réintégré' : 'Profil suspendu');
                fetchProfiles();
            }
        );
    }

    return (
        <div>
            <ToastContainer toasts={toasts} onRemove={removeToast} />

            {/* Filters */}
            <div className="flex gap-3 mb-4 flex-wrap">
                {(['', ProfileStatus.PENDING, ProfileStatus.APPROVED, ProfileStatus.REJECTED, ProfileStatus.SUSPENDED] as const).map(s => (
                    <button
                        key={s}
                        onClick={() => setStatusFilter(s)}
                        className={`px-3 py-1 rounded text-sm font-medium transition-colors ${statusFilter === s ? 'bg-pink-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                    >
                        {s === '' ? 'Tous' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                ))}
            </div>

            {isLoading ? (
                <p className="text-gray-400 py-8 text-center">Chargement…</p>
            ) : profiles.length === 0 ? (
                <p className="text-gray-400 py-8 text-center">Aucun profil trouvé.</p>
            ) : (
                <div className="overflow-x-auto rounded-lg">
                    <table className="min-w-full divide-y divide-gray-700">
                        <thead className="bg-gray-700">
                            <tr>
                                {['Membre', 'Photos', 'Intention', 'Signalements', 'Statut', 'Créé le', 'Actions'].map(h => (
                                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-gray-800 divide-y divide-gray-700">
                            {profiles.map(p => (
                                <tr key={p._id} className="hover:bg-gray-750">
                                    <td className="px-4 py-3 text-sm">
                                        <button onClick={() => setReviewing(p)} className="text-left hover:underline">
                                            <span className="text-gray-200">{p.displayName || p.memberName || <span className="text-gray-500 italic">—</span>}</span>
                                            {p.memberName && p.displayName && <span className="block text-xs text-gray-500">{p.memberName}</span>}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        {/* First frame as a thumbnail: most rejects are decided on the
                                            photos, and the count says whether approval is even possible. */}
                                        <div className="flex items-center gap-2">
                                            {p.photos[0]?.url
                                                ? <img src={p.photos[0].url} alt="" className="w-9 h-9 rounded object-cover" />
                                                : <span className="w-9 h-9 rounded bg-gray-700 grid place-items-center text-gray-500 text-xs">—</span>}
                                            <span className={p.meetsPhotoRequirement ? 'text-gray-300' : 'text-yellow-400'}>
                                                {p.photoCount}/{p.minPhotos}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-300">{INTENTION_LABELS[p.intention] ?? p.intention}</td>
                                    <td className="px-4 py-3 text-sm text-center text-gray-300">{p.moderation.reportCount}</td>
                                    <td className="px-4 py-3"><span className={statusBadge(p.status)}>{p.status}</span></td>
                                    <td className="px-4 py-3 text-sm text-gray-400">{new Date(p.createdAt).toLocaleDateString('fr-FR')}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex gap-2 flex-wrap">
                                            <button onClick={() => setReviewing(p)} className="px-2 py-1 text-xs bg-pink-700 hover:bg-pink-600 text-white rounded">Examiner</button>
                                            {p.status === ProfileStatus.PENDING && (
                                                <>
                                                    <button onClick={() => handleApprove(p)} className="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded">Approuver</button>
                                                    <button onClick={() => openReject(p)} className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded">Rejeter</button>
                                                </>
                                            )}
                                            {p.status === ProfileStatus.APPROVED && (
                                                <button onClick={() => handleSuspend(p)} className="px-2 py-1 text-xs bg-yellow-700 hover:bg-yellow-600 text-white rounded">Suspendre</button>
                                            )}
                                            {p.status === ProfileStatus.SUSPENDED && (
                                                <button onClick={() => handleSuspend(p)} className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded">Réintégrer</button>
                                            )}
                                            {p.status === ProfileStatus.REJECTED && (
                                                <button onClick={() => handleApprove(p)} className="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded">Approuver</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

            {/* Confirm modal */}
            {confirmModal && (
                <ConfirmationModal
                    isOpen={confirmOpen}
                    title={confirmModal.title}
                    message={confirmModal.message}
                    confirmText="Confirmer"
                    cancelText="Annuler"
                    isLoading={confirmLoading}
                    onConfirm={handleConfirm}
                    onCancel={() => { setConfirmOpen(false); setConfirmModal(null); }}
                />
            )}

            {reviewing && (
                <ProfileReviewModal
                    profile={reviewing}
                    isBusy={reviewBusy}
                    onClose={() => setReviewing(null)}
                    onApprove={() => reviewApprove(reviewing)}
                    onReject={(reason) => reviewReject(reviewing, reason)}
                />
            )}

            {/* Reject reason modal */}
            {rejectModalOpen && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md shadow-xl">
                        <h3 className="text-lg font-semibold text-white mb-4">Rejeter le profil</h3>
                        <label className="block text-sm text-gray-300 mb-1">Motif du rejet (optionnel)</label>
                        <textarea
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            rows={3}
                            className="w-full bg-gray-700 text-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                            placeholder="Ex : contenu inapproprié…"
                        />
                        <div className="flex justify-end gap-3 mt-4">
                            <button onClick={() => setRejectModalOpen(false)} className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded">Annuler</button>
                            <button onClick={handleRejectSubmit} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded">Rejeter</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Members Tab ─────────────────────────────────────────────────────────────

/** One dashboard figure. Four of these read at a glance; a paragraph does not. */
function StatCard({ label, value, hint, tone = 'default' }: {
    label: string; value: number | string; hint?: string; tone?: 'default' | 'warn';
}) {
    return (
        <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
            <p className={`text-2xl font-bold ${tone === 'warn' ? 'text-yellow-400' : 'text-white'}`}>{value}</p>
            {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
        </div>
    );
}

/**
 * Every SBCLOVE member, with how many matches they have and how many of those
 * became a conversation.
 *
 * Server-side paginated on purpose: the tallies are computed for the page's
 * members only (one aggregation), so the cost of this screen does not grow with
 * the member base.
 */
function MembersTab() {
    const { toasts, removeToast, showError } = useToast();
    const [rows, setRows] = useState<MemberRow[]>([]);
    const [stats, setStats] = useState<SbcLoveStats | null>(null);
    const [statusFilter, setStatusFilter] = useState<ProfileStatus | ''>('');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    const fetchRows = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await listMembers({ status: statusFilter || undefined, page, limit });
            setRows(res.data);
            setTotalPages(res.pagination.totalPages);
            setTotal(res.pagination.total);
        } catch (err) {
            showError(handleError(err));
            setRows([]);
        } finally {
            setIsLoading(false);
        }
    }, [statusFilter, page, limit]);

    useEffect(() => { fetchRows(); }, [fetchRows]);
    useEffect(() => { setPage(1); }, [statusFilter, limit]);
    useEffect(() => { getStats().then(setStats).catch(() => setStats(null)); }, []);

    return (
        <div>
            <ToastContainer toasts={toasts} onRemove={removeToast} />

            {stats && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                    <StatCard label="Profils" value={stats.profiles.total}
                        hint={`${stats.profiles.approved} approuvés · ${stats.profiles.pending} en attente`} />
                    <StatCard label="En attente de validation" value={stats.profiles.pending}
                        tone={stats.profiles.pending > 0 ? 'warn' : 'default'} hint="à examiner dans l'onglet Profils" />
                    <StatCard label="Matchs" value={stats.matches.total}
                        hint={`${stats.matches.contactUnlocked} contacts ouverts`} />
                    <StatCard label="Conversations" value={stats.matches.conversations}
                        hint={`${stats.interests.total} intérêts au total`} />
                </div>
            )}

            <div className="flex gap-3 mb-4 flex-wrap items-center">
                {(['', ProfileStatus.PENDING, ProfileStatus.APPROVED, ProfileStatus.REJECTED, ProfileStatus.SUSPENDED] as const).map(st => (
                    <button
                        key={st}
                        onClick={() => setStatusFilter(st)}
                        className={`px-3 py-1 rounded text-sm font-medium transition-colors ${statusFilter === st ? 'bg-pink-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                    >
                        {st === '' ? 'Tous' : st.charAt(0).toUpperCase() + st.slice(1)}
                    </button>
                ))}
                <span className="ml-auto flex items-center gap-2 text-sm text-gray-400">
                    {total} membre(s)
                    <select
                        value={limit}
                        onChange={e => setLimit(Number(e.target.value))}
                        className="bg-gray-700 text-gray-200 rounded px-2 py-1 text-sm"
                    >
                        {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
                    </select>
                </span>
            </div>

            {isLoading ? (
                <p className="text-gray-400 py-8 text-center">Chargement…</p>
            ) : rows.length === 0 ? (
                <p className="text-gray-400 py-8 text-center">Aucun membre trouvé.</p>
            ) : (
                <div className="overflow-x-auto rounded-lg">
                    <table className="min-w-full divide-y divide-gray-700">
                        <thead className="bg-gray-700">
                            <tr>
                                {['Membre', 'Sexe / Âge', 'Ville', 'Statut', 'Photos', 'Matchs', 'Conversations', 'Signalements', 'Inscrit le'].map(h => (
                                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-gray-800 divide-y divide-gray-700">
                            {rows.map(r => (
                                <tr key={r._id} className="hover:bg-gray-750">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            {r.photoUrl
                                                ? <img src={r.photoUrl} alt="" className="w-9 h-9 rounded object-cover" />
                                                : <span className="w-9 h-9 rounded bg-gray-700 grid place-items-center text-gray-500 text-xs">—</span>}
                                            <div className="min-w-0">
                                                <p className="text-sm text-gray-200 truncate">{r.displayName}</p>
                                                <p className="text-xs text-gray-500 truncate">{r.memberEmail ?? r.memberName ?? r.userId}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-300">{[r.sex, r.ageBracket].filter(Boolean).join(' · ') || '—'}</td>
                                    <td className="px-4 py-3 text-sm text-gray-300">{r.city ?? '—'}</td>
                                    <td className="px-4 py-3"><span className={statusBadge(r.status)}>{r.status}</span></td>
                                    <td className={`px-4 py-3 text-sm ${r.photoCount >= 2 ? 'text-gray-300' : 'text-yellow-400'}`}>{r.photoCount}</td>
                                    <td className="px-4 py-3 text-sm text-gray-200 font-medium">{r.matches}</td>
                                    <td className="px-4 py-3 text-sm text-gray-200 font-medium">{r.conversations}</td>
                                    <td className="px-4 py-3 text-sm text-gray-300">{r.reportCount}</td>
                                    <td className="px-4 py-3 text-sm text-gray-400">
                                        {r.createdAt ? new Date(r.createdAt).toLocaleDateString('fr-FR') : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
    );
}

// ─── Reports Tab ─────────────────────────────────────────────────────────────

function ReportsTab() {
    const { toasts, removeToast, showSuccess, showError } = useToast();
    const [reports, setReports] = useState<Report[]>([]);
    const [statusFilter, setStatusFilter] = useState<ReportStatus | ''>('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [isLoading, setIsLoading] = useState(true);

    const [confirmModal, setConfirmModal] = useState<{
        title: string; message: string; onConfirm: () => Promise<void>;
    } | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmLoading, setConfirmLoading] = useState(false);

    const fetchReports = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await listReports({ status: statusFilter || undefined, page, limit: 15 });
            setReports(res.data);
            setTotalPages(res.pagination.totalPages);
        } catch (err) {
            showError(handleError(err));
            setReports([]);
        } finally {
            setIsLoading(false);
        }
    }, [statusFilter, page]);

    useEffect(() => { fetchReports(); }, [fetchReports]);
    useEffect(() => { setPage(1); }, [statusFilter]);

    function openConfirm(title: string, message: string, action: () => Promise<void>) {
        setConfirmModal({ title, message, onConfirm: action });
        setConfirmOpen(true);
    }

    async function handleConfirm() {
        if (!confirmModal) return;
        setConfirmLoading(true);
        try { await confirmModal.onConfirm(); }
        finally { setConfirmLoading(false); setConfirmOpen(false); setConfirmModal(null); }
    }

    function handleReview(report: Report, status: ReportStatus.REVIEWED | ReportStatus.DISMISSED) {
        const label = status === ReportStatus.REVIEWED ? 'Marquer comme traité' : 'Ignorer';
        openConfirm(label, `${label} ce signalement ?`, async () => {
            await reviewReport(report._id, status);
            showSuccess('Signalement mis à jour');
            fetchReports();
        });
    }

    return (
        <div>
            <ToastContainer toasts={toasts} onRemove={removeToast} />

            <div className="flex gap-3 mb-4 flex-wrap">
                {(['', ReportStatus.OPEN, ReportStatus.REVIEWED, ReportStatus.DISMISSED] as const).map(s => (
                    <button
                        key={s}
                        onClick={() => setStatusFilter(s)}
                        className={`px-3 py-1 rounded text-sm font-medium transition-colors ${statusFilter === s ? 'bg-pink-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                    >
                        {s === '' ? 'Tous' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                ))}
            </div>

            {isLoading ? (
                <p className="text-gray-400 py-8 text-center">Chargement…</p>
            ) : reports.length === 0 ? (
                <p className="text-gray-400 py-8 text-center">Aucun signalement trouvé.</p>
            ) : (
                <div className="overflow-x-auto rounded-lg">
                    <table className="min-w-full divide-y divide-gray-700">
                        <thead className="bg-gray-700">
                            <tr>
                                {['Signalé par', 'Profil signalé', 'Motif', 'Statut', 'Date', 'Actions'].map(h => (
                                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-gray-800 divide-y divide-gray-700">
                            {reports.map(r => (
                                <tr key={r._id} className="hover:bg-gray-750">
                                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{r.reporterId}</td>
                                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{r.reportedUserId}</td>
                                    <td className="px-4 py-3 text-sm text-gray-300 max-w-xs truncate">{r.reason}</td>
                                    <td className="px-4 py-3"><span className={statusBadge(r.status)}>{r.status}</span></td>
                                    <td className="px-4 py-3 text-sm text-gray-400">{new Date(r.createdAt).toLocaleDateString('fr-FR')}</td>
                                    <td className="px-4 py-3">
                                        {r.status === ReportStatus.OPEN && (
                                            <div className="flex gap-2">
                                                <button onClick={() => handleReview(r, ReportStatus.REVIEWED)} className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded">Traiter</button>
                                                <button onClick={() => handleReview(r, ReportStatus.DISMISSED)} className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded">Ignorer</button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

            {confirmModal && (
                <ConfirmationModal
                    isOpen={confirmOpen}
                    title={confirmModal.title}
                    message={confirmModal.message}
                    confirmText="Confirmer"
                    cancelText="Annuler"
                    isLoading={confirmLoading}
                    onConfirm={handleConfirm}
                    onCancel={() => { setConfirmOpen(false); setConfirmModal(null); }}
                />
            )}
        </div>
    );
}

// ─── Config Tab ───────────────────────────────────────────────────────────────

function ConfigTab() {
    const { toasts, removeToast, showSuccess, showError } = useToast();
    const [config, setConfig] = useState<ModuleConfig | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [draft, setDraft] = useState<Partial<ModuleConfig>>({});

    useEffect(() => {
        getModuleConfig()
            .then(c => { setConfig(c); setDraft(c); })
            .catch(err => showError(handleError(err)))
            .finally(() => setIsLoading(false));
    }, []);

    function set<K extends keyof ModuleConfig>(key: K, value: ModuleConfig[K]) {
        setDraft(prev => ({ ...prev, [key]: value }));
    }

    async function handleSave() {
        setIsSaving(true);
        try {
            const updated = await updateModuleConfig(draft);
            setConfig(updated);
            setDraft(updated);
            showSuccess('Configuration mise à jour');
        } catch (err) {
            showError(handleError(err));
        } finally {
            setIsSaving(false);
        }
    }

    if (isLoading) return <p className="text-gray-400 py-8 text-center">Chargement…</p>;
    if (!config) return <p className="text-red-400 py-8 text-center">Impossible de charger la configuration.</p>;

    return (
        <div>
            <ToastContainer toasts={toasts} onRemove={removeToast} />
            <div className="max-w-xl space-y-6">

                {/* Enable/disable */}
                <div className="bg-gray-700 rounded-lg p-4 flex items-center justify-between">
                    <div>
                        <p className="text-white font-medium">Module actif</p>
                        <p className="text-gray-400 text-sm">Activer ou désactiver SBC Love globalement</p>
                    </div>
                    <button
                        onClick={() => set('enabled', !draft.enabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${draft.enabled ? 'bg-pink-600' : 'bg-gray-500'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${draft.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Auto approve */}
                <div className="bg-gray-700 rounded-lg p-4 flex items-center justify-between">
                    <div>
                        <p className="text-white font-medium">Approbation automatique</p>
                        <p className="text-gray-400 text-sm">Approuver les profils sans validation manuelle</p>
                    </div>
                    <button
                        onClick={() => set('autoApprove', !draft.autoApprove)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${draft.autoApprove ? 'bg-pink-600' : 'bg-gray-500'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${draft.autoApprove ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* Window settings */}
                <div className="bg-gray-700 rounded-lg p-4 space-y-4">
                    <p className="text-white font-medium">Fenêtre d'activité</p>

                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Jour actif</label>
                        <select
                            value={draft.activeWeekday ?? config.activeWeekday}
                            onChange={e => set('activeWeekday', Number(e.target.value))}
                            className="w-full bg-gray-600 text-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        >
                            {WEEKDAY_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-gray-300 mb-1">Heure d'ouverture</label>
                            <input
                                type="number" min={0} max={23}
                                value={draft.openHour ?? config.openHour}
                                onChange={e => set('openHour', Number(e.target.value))}
                                className="w-full bg-gray-600 text-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-300 mb-1">Heure de fermeture</label>
                            <input
                                type="number" min={0} max={23}
                                value={draft.closeHour ?? config.closeHour}
                                onChange={e => set('closeHour', Number(e.target.value))}
                                className="w-full bg-gray-600 text-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Fuseau horaire</label>
                        <input
                            type="text"
                            value={draft.timezone ?? config.timezone}
                            onChange={e => set('timezone', e.target.value)}
                            className="w-full bg-gray-600 text-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                            placeholder="Africa/Douala"
                        />
                    </div>
                </div>

                {/* Quotas */}
                <div className="bg-gray-700 rounded-lg p-4 space-y-4">
                    <p className="text-white font-medium">Quotas & seuils</p>

                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Intérêts max par semaine</label>
                        <input
                            type="number" min={1}
                            value={draft.maxInterestsPerWeek ?? config.maxInterestsPerWeek}
                            onChange={e => set('maxInterestsPerWeek', Number(e.target.value))}
                            className="w-full bg-gray-600 text-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Seuil de suspension automatique (signalements)</label>
                        <input
                            type="number" min={1}
                            value={draft.autoSuspendThreshold ?? config.autoSuspendThreshold}
                            onChange={e => set('autoSuspendThreshold', Number(e.target.value))}
                            className="w-full bg-gray-600 text-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        />
                    </div>
                </div>

                <div className="flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-5 py-2 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
                    >
                        {isSaving ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                </div>

                {config.updatedAt && (
                    <p className="text-xs text-gray-500 text-right">
                        Dernière mise à jour : {new Date(config.updatedAt).toLocaleString('fr-FR')}
                        {config.updatedBy ? ` par ${config.updatedBy}` : ''}
                    </p>
                )}
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
    { id: 'members', label: 'Membres' },
    { id: 'profiles', label: 'Profils' },
    { id: 'reports', label: 'Signalements' },
    { id: 'config', label: 'Configuration' },
];

const SbcLoveManagementPage = () => {
    const [activeTab, setActiveTab] = useState<Tab>('members');

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100">
            <Header title="SBC Love – Administration" />

            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                {/* Page header */}
                <div className="mb-6">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <span>💗</span> SBC Love
                    </h2>
                    <p className="text-gray-400 text-sm mt-1">
                        Modération des profils, gestion des signalements et configuration du module.
                    </p>
                </div>

                {/* Tabs */}
                <div className="border-b border-gray-700 mb-6">
                    <nav className="flex gap-1">
                        {TABS.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                                    activeTab === tab.id
                                        ? 'bg-gray-800 text-pink-400 border-b-2 border-pink-500'
                                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Tab content */}
                {activeTab === 'members' && <MembersTab />}
                {activeTab === 'profiles' && <ProfilesTab />}
                {activeTab === 'reports' && <ReportsTab />}
                {activeTab === 'config' && <ConfigTab />}
            </main>
        </div>
    );
};

export default SbcLoveManagementPage;
