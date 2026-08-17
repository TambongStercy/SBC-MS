import { useCallback, useEffect, useState } from 'react';
import { Heart, ShieldAlert, Settings as SettingsIcon, Check, X, Ban, RotateCcw } from 'lucide-react';
import { ImageDisplay } from '../components/common/ImageDisplay';
import Pagination from '../components/common/Pagination';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToggleSwitch from '../components/common/ToggleSwitch';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import {
    listSbcloveProfiles,
    validateSbcloveProfile,
    setSbcloveProfileSuspension,
    listSbcloveReports,
    reviewSbcloveReport,
    getSbcloveModuleConfig,
    updateSbcloveModuleConfig,
    INTENTION_LABELS,
    type SbcloveAdminProfile,
    type SbcloveReport,
    type SbcloveModuleConfig,
    type ProfileStatus,
    type ReportStatus,
} from '../services/adminSbcloveApi';

type Tab = 'profiles' | 'reports' | 'settings';

const STATUS_BADGE: Record<ProfileStatus, string> = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    suspended: 'bg-gray-200 text-gray-700',
};

const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const PAGE_LIMIT = 12;

function SbcLoveManagementPage() {
    const { toasts, removeToast, showSuccess, showError } = useToast();
    const [tab, setTab] = useState<Tab>('profiles');

    // Profiles
    const [profileFilter, setProfileFilter] = useState<ProfileStatus>('pending');
    const [profiles, setProfiles] = useState<SbcloveAdminProfile[]>([]);
    const [profilePage, setProfilePage] = useState(1);
    const [profileTotal, setProfileTotal] = useState(0);
    const [loadingProfiles, setLoadingProfiles] = useState(false);

    // Reports
    const [reports, setReports] = useState<SbcloveReport[]>([]);
    const [reportPage, setReportPage] = useState(1);
    const [reportTotal, setReportTotal] = useState(0);
    const [loadingReports, setLoadingReports] = useState(false);

    // Settings
    const [config, setConfig] = useState<SbcloveModuleConfig | null>(null);
    const [savingConfig, setSavingConfig] = useState(false);

    // Confirmation modal
    const [confirm, setConfirm] = useState<{
        title: string; message: string; onConfirm: () => void; withReason?: boolean;
    } | null>(null);
    const [reason, setReason] = useState('');
    const [confirmLoading, setConfirmLoading] = useState(false);

    const loadProfiles = useCallback(async () => {
        setLoadingProfiles(true);
        try {
            const res = await listSbcloveProfiles({ status: profileFilter, page: profilePage, limit: PAGE_LIMIT });
            setProfiles(res.data ?? []);
            setProfileTotal(res.pagination?.total ?? 0);
        } catch (e) {
            showError(e instanceof Error ? e.message : 'Erreur de chargement.');
        } finally {
            setLoadingProfiles(false);
        }
    }, [profileFilter, profilePage, showError]);

    const loadReports = useCallback(async () => {
        setLoadingReports(true);
        try {
            const res = await listSbcloveReports({ status: 'open', page: reportPage, limit: PAGE_LIMIT });
            setReports(res.data ?? []);
            setReportTotal(res.pagination?.total ?? 0);
        } catch (e) {
            showError(e instanceof Error ? e.message : 'Erreur de chargement.');
        } finally {
            setLoadingReports(false);
        }
    }, [reportPage, showError]);

    const loadConfig = useCallback(async () => {
        try {
            setConfig(await getSbcloveModuleConfig());
        } catch (e) {
            showError(e instanceof Error ? e.message : 'Erreur de chargement.');
        }
    }, [showError]);

    useEffect(() => { if (tab === 'profiles') loadProfiles(); }, [tab, loadProfiles]);
    useEffect(() => { if (tab === 'reports') loadReports(); }, [tab, loadReports]);
    useEffect(() => { if (tab === 'settings') loadConfig(); }, [tab, loadConfig]);

    const runConfirm = async (fn: () => Promise<unknown>, success: string) => {
        setConfirmLoading(true);
        try {
            await fn();
            showSuccess(success);
            setConfirm(null);
            setReason('');
            if (tab === 'profiles') loadProfiles();
            if (tab === 'reports') loadReports();
        } catch (e) {
            showError(e instanceof Error ? e.message : 'Action échouée.');
        } finally {
            setConfirmLoading(false);
        }
    };

    // --- Profile actions ---
    const approve = (p: SbcloveAdminProfile) => setConfirm({
        title: 'Valider le profil',
        message: `Valider le profil « ${p.displayName || p.userId} » ? Il deviendra visible dans SBC Love.`,
        onConfirm: () => runConfirm(() => validateSbcloveProfile(p._id, true), 'Profil validé.'),
    });
    const reject = (p: SbcloveAdminProfile) => setConfirm({
        title: 'Refuser le profil',
        message: `Indiquez le motif du refus pour « ${p.displayName || p.userId} ».`,
        withReason: true,
        onConfirm: () => runConfirm(() => validateSbcloveProfile(p._id, false, reason.trim() || undefined), 'Profil refusé.'),
    });
    const suspend = (p: SbcloveAdminProfile) => setConfirm({
        title: 'Suspendre le profil',
        message: `Suspendre « ${p.displayName || p.userId} » ? Il ne sera plus visible.`,
        withReason: true,
        onConfirm: () => runConfirm(() => setSbcloveProfileSuspension(p._id, true, reason.trim() || undefined), 'Profil suspendu.'),
    });
    const reinstate = (p: SbcloveAdminProfile) => setConfirm({
        title: 'Réactiver le profil',
        message: `Réactiver « ${p.displayName || p.userId} » ? Le compteur de signalements sera remis à zéro.`,
        onConfirm: () => runConfirm(() => setSbcloveProfileSuspension(p._id, false), 'Profil réactivé.'),
    });

    // --- Report actions ---
    const reviewReport = (r: SbcloveReport, status: ReportStatus) => runConfirm(
        () => reviewSbcloveReport(r._id, status),
        status === 'reviewed' ? 'Signalement traité.' : 'Signalement rejeté.',
    );

    const saveConfig = async () => {
        if (!config) return;
        setSavingConfig(true);
        try {
            const updated = await updateSbcloveModuleConfig(config);
            setConfig(updated);
            showSuccess('Configuration enregistrée.');
        } catch (e) {
            showError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
        } finally {
            setSavingConfig(false);
        }
    };

    const tabBtn = (id: Tab, label: string, Icon: typeof Heart) => (
        <button
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${tab === id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
            <Icon size={16} /> {label}
        </button>
    );

    return (
        <div className="p-6">
            <div className="flex items-center gap-2 mb-6">
                <Heart className="text-blue-600" />
                <h1 className="text-2xl font-bold text-gray-800">SBC Love</h1>
            </div>

            <div className="flex gap-2 mb-6">
                {tabBtn('profiles', 'Profils', Heart)}
                {tabBtn('reports', 'Signalements', ShieldAlert)}
                {tabBtn('settings', 'Paramètres', SettingsIcon)}
            </div>

            {/* PROFILES */}
            {tab === 'profiles' && (
                <div>
                    <div className="flex items-center gap-2 mb-4">
                        <label className="text-sm text-gray-600">Statut :</label>
                        <select
                            value={profileFilter}
                            onChange={(e) => { setProfilePage(1); setProfileFilter(e.target.value as ProfileStatus); }}
                            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
                        >
                            <option value="pending">En attente</option>
                            <option value="approved">Validés</option>
                            <option value="rejected">Refusés</option>
                            <option value="suspended">Suspendus</option>
                        </select>
                    </div>

                    {loadingProfiles ? (
                        <p className="text-gray-500">Chargement…</p>
                    ) : profiles.length === 0 ? (
                        <p className="text-gray-500">Aucun profil.</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {profiles.map((p) => (
                                <div key={p._id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                    <div className="flex gap-1 h-40 bg-gray-100">
                                        {p.photos.length > 0 ? p.photos.slice(0, 3).map((ph) => (
                                            <div key={ph.fileId} className="flex-1 overflow-hidden">
                                                <ImageDisplay fileId={ph.fileId} alt={p.displayName || 'photo'} />
                                            </div>
                                        )) : <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Aucune photo</div>}
                                    </div>
                                    <div className="p-4">
                                        <div className="flex items-center justify-between">
                                            <p className="font-semibold text-gray-800 truncate">{p.displayName || '(sans pseudo)'}</p>
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[p.status]}`}>{p.status}</span>
                                        </div>
                                        <p className="text-xs text-blue-600 mt-0.5">
                                            {p.intention === 'autre' ? p.otherIntentionText : INTENTION_LABELS[p.intention]}
                                        </p>
                                        <p className="text-sm text-gray-600 mt-2 line-clamp-3">{p.description}</p>
                                        <p className="text-xs text-gray-400 mt-2">
                                            Signalements : {p.moderation.reportCount} · User : {p.userId}
                                        </p>

                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {p.status !== 'approved' && (
                                                <button onClick={() => approve(p)} className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700">
                                                    <Check size={13} /> Valider
                                                </button>
                                            )}
                                            {p.status !== 'rejected' && p.status !== 'suspended' && (
                                                <button onClick={() => reject(p)} className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700">
                                                    <X size={13} /> Refuser
                                                </button>
                                            )}
                                            {p.status === 'suspended' ? (
                                                <button onClick={() => reinstate(p)} className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                                                    <RotateCcw size={13} /> Réactiver
                                                </button>
                                            ) : (
                                                <button onClick={() => suspend(p)} className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-700 text-white hover:bg-gray-800">
                                                    <Ban size={13} /> Suspendre
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="mt-6">
                        <Pagination currentPage={profilePage} totalPages={Math.max(1, Math.ceil(profileTotal / PAGE_LIMIT))} onPageChange={setProfilePage} />
                    </div>
                </div>
            )}

            {/* REPORTS */}
            {tab === 'reports' && (
                <div>
                    {loadingReports ? (
                        <p className="text-gray-500">Chargement…</p>
                    ) : reports.length === 0 ? (
                        <p className="text-gray-500">Aucun signalement ouvert.</p>
                    ) : (
                        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-gray-600">
                                    <tr>
                                        <th className="text-left px-4 py-2">Motif</th>
                                        <th className="text-left px-4 py-2">Profil signalé</th>
                                        <th className="text-left px-4 py-2">Auteur</th>
                                        <th className="text-left px-4 py-2">Date</th>
                                        <th className="text-right px-4 py-2">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reports.map((r) => (
                                        <tr key={r._id} className="border-t border-gray-100">
                                            <td className="px-4 py-2 max-w-xs"><p className="line-clamp-2">{r.reason}</p></td>
                                            <td className="px-4 py-2 text-gray-500">{r.reportedUserId}</td>
                                            <td className="px-4 py-2 text-gray-500">{r.reporterId}</td>
                                            <td className="px-4 py-2 text-gray-500">{new Date(r.createdAt).toLocaleDateString('fr-FR')}</td>
                                            <td className="px-4 py-2">
                                                <div className="flex gap-2 justify-end">
                                                    <button onClick={() => reviewReport(r, 'reviewed')} className="text-xs px-3 py-1 rounded-lg bg-green-600 text-white hover:bg-green-700">Traité</button>
                                                    <button onClick={() => reviewReport(r, 'dismissed')} className="text-xs px-3 py-1 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300">Rejeter</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div className="mt-6">
                        <Pagination currentPage={reportPage} totalPages={Math.max(1, Math.ceil(reportTotal / PAGE_LIMIT))} onPageChange={setReportPage} />
                    </div>
                </div>
            )}

            {/* SETTINGS */}
            {tab === 'settings' && config && (
                <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                        <div>
                            <p className="font-medium text-gray-800">Module activé</p>
                            <p className="text-xs text-gray-500">Interrupteur global. Désactivé = SBC Love fermé pour tous.</p>
                        </div>
                        <ToggleSwitch name="enabled" initialChecked={config.enabled} onToggle={(v) => setConfig({ ...config, enabled: v })} />
                    </div>

                    <div className="grid grid-cols-2 gap-4 py-4">
                        <label className="text-sm">
                            <span className="block text-gray-600 mb-1">Jour d'ouverture</span>
                            <select value={config.activeWeekday} onChange={(e) => setConfig({ ...config, activeWeekday: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white">
                                {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                            </select>
                        </label>
                        <label className="text-sm">
                            <span className="block text-gray-600 mb-1">Fuseau horaire</span>
                            <input value={config.timezone} onChange={(e) => setConfig({ ...config, timezone: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                        </label>
                        <label className="text-sm">
                            <span className="block text-gray-600 mb-1">Heure d'ouverture</span>
                            <input type="number" min={0} max={23} value={config.openHour} onChange={(e) => setConfig({ ...config, openHour: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                        </label>
                        <label className="text-sm">
                            <span className="block text-gray-600 mb-1">Heure de fermeture</span>
                            <input type="number" min={0} max={23} value={config.closeHour} onChange={(e) => setConfig({ ...config, closeHour: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                        </label>
                        <label className="text-sm">
                            <span className="block text-gray-600 mb-1">Intérêts max / semaine</span>
                            <input type="number" min={1} value={config.maxInterestsPerWeek} onChange={(e) => setConfig({ ...config, maxInterestsPerWeek: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                        </label>
                        <label className="text-sm">
                            <span className="block text-gray-600 mb-1">Seuil de suspension auto</span>
                            <input type="number" min={1} value={config.autoSuspendThreshold} onChange={(e) => setConfig({ ...config, autoSuspendThreshold: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                        </label>
                    </div>

                    <div className="flex items-center justify-between py-3 border-t border-gray-100">
                        <div>
                            <p className="font-medium text-gray-800">Validation automatique</p>
                            <p className="text-xs text-gray-500">Si activé, les profils conformes sont validés sans revue manuelle.</p>
                        </div>
                        <ToggleSwitch name="autoApprove" initialChecked={config.autoApprove} onToggle={(v) => setConfig({ ...config, autoApprove: v })} />
                    </div>

                    <button onClick={saveConfig} disabled={savingConfig} className="mt-4 px-5 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50">
                        {savingConfig ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                </div>
            )}

            {confirm && (
                <ConfirmationModal
                    isOpen={true}
                    title={confirm.title}
                    message={confirm.message}
                    confirmText="Confirmer"
                    cancelText="Annuler"
                    isLoading={confirmLoading}
                    onConfirm={confirm.onConfirm}
                    onCancel={() => { setConfirm(null); setReason(''); }}
                >
                    {confirm.withReason && (
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            placeholder="Motif (optionnel)"
                            className="mt-3 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                    )}
                </ConfirmationModal>
            )}

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}

export default SbcLoveManagementPage;
