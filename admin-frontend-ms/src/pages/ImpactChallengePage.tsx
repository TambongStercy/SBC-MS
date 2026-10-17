import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Trophy } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import Pagination from '../components/common/Pagination';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import ChallengeFormModal from '../components/impactChallenge/ChallengeFormModal';
import { StatusBadge } from '../components/impactChallenge/shared';
import { btn, panelClass } from '../components/impactChallenge/styles';
import {
    ChallengeStatus,
    ImpactChallenge,
    STATUS_LABELS,
    apiErrorMessage,
    deleteChallenge,
    formatDay,
    formatXaf,
    listChallenges,
    monthLabel,
    updateChallengeStatus,
} from '../services/impactChallengeApi';

const PAGE_SIZE = 10;

type PendingAction = { kind: 'activate' | 'cancel' | 'delete'; challenge: ImpactChallenge };

/** What the service allows, so the buttons offered are the ones that will work. */
const canActivate = (c: ImpactChallenge) => c.status === 'draft';
const canCancel = (c: ImpactChallenge) =>
    ['draft', 'active', 'voting_closed'].includes(c.status) && (c.totalCollected ?? 0) === 0;
const canDelete = (c: ImpactChallenge) => (c.status === 'draft' || c.status === 'cancelled') && (c.totalVoteCount ?? 0) === 0;

/** All Impact Challenges, newest month first: create, open the votes, cancel, delete. */
const ImpactChallengePage: React.FC = () => {
    const navigate = useNavigate();
    const { toasts, removeToast, showSuccess, showError } = useToast();

    const [challenges, setChallenges] = useState<ImpactChallenge[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState<ChallengeStatus | ''>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [pending, setPending] = useState<PendingAction | null>(null);

    const fetchChallenges = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await listChallenges(page, PAGE_SIZE, statusFilter || undefined);
            setChallenges(res.challenges || []);
            setTotal(res.total || 0);
        } catch (err) {
            setError(apiErrorMessage(err, 'Impossible de charger les challenges.'));
            setChallenges([]);
        } finally {
            setLoading(false);
        }
    }, [page, statusFilter]);

    useEffect(() => { fetchChallenges(); }, [fetchChallenges]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const runPending = async () => {
        if (!pending) return;
        const { kind, challenge } = pending;
        try {
            if (kind === 'activate') {
                await updateChallengeStatus(challenge._id, 'active');
                showSuccess(`Votes ouverts pour « ${challenge.campaignName} ».`);
            } else if (kind === 'cancel') {
                await updateChallengeStatus(challenge._id, 'cancelled');
                showSuccess(`« ${challenge.campaignName} » est annulé.`);
            } else {
                await deleteChallenge(challenge._id);
                showSuccess(`« ${challenge.campaignName} » est supprimé.`);
            }
            setPending(null);
            fetchChallenges();
        } catch (err) {
            showError(apiErrorMessage(err, 'L’action a échoué.'));
            setPending(null);
        }
    };

    const confirmCopy = (p: PendingAction) => {
        const c = p.challenge;
        if (p.kind === 'activate') {
            return {
                title: 'Ouvrir les votes ?',
                variant: 'success' as const,
                confirmText: 'Ouvrir les votes',
                message: (
                    <div className="space-y-2 text-sm">
                        <p>« {c.campaignName} » apparaît dans l’app : les membres paient pour voter, et chaque vote leur donne aussi des tickets de la tombola du mois.</p>
                        <p className="text-gray-400">Il faut au moins un entrepreneur approuvé, et aucun autre challenge ne doit avoir ses votes ouverts.</p>
                    </div>
                ),
            };
        }
        if (p.kind === 'cancel') {
            return {
                title: 'Annuler ce challenge ?',
                variant: 'danger' as const,
                confirmText: 'Annuler le challenge',
                message: <p className="text-sm">« {c.campaignName} » s’arrête et ne pourra plus être rouvert. Rien n’a été collecté, donc personne n’est à rembourser.</p>,
            };
        }
        return {
            title: 'Supprimer ce challenge ?',
            variant: 'danger' as const,
            confirmText: 'Supprimer',
            message: <p className="text-sm">« {c.campaignName} » disparaît de la liste. C’est définitif. La tombola du mois reste.</p>,
        };
    };

    return (
        <div className="flex-1 overflow-auto relative z-10">
            <Header title="Impact Challenge" />
            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                <motion.div
                    className={`${panelClass} p-6 mb-6`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-semibold text-gray-100 flex items-center gap-2">
                                <Trophy className="w-5 h-5 text-amber-400" /> Challenges du mois
                            </h2>
                            <p className="text-sm text-gray-400 mt-1">
                                Chaque mois, jusqu’à 3 entrepreneurs présentent leur projet en vidéo. Les membres paient pour voter, le plus voté gagne.
                                L’argent collecté est réparti : 50 % au gagnant, 30 % à la cagnotte de la tombola, 20 % à SBC.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <select
                                value={statusFilter}
                                onChange={e => { setStatusFilter(e.target.value as ChallengeStatus | ''); setPage(1); }}
                                className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Tous les statuts</option>
                                {(Object.keys(STATUS_LABELS) as ChallengeStatus[]).map(s => (
                                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                                ))}
                            </select>
                            <button onClick={fetchChallenges} className={btn.secondary}>
                                <RefreshCw className="w-4 h-4" /> Rafraîchir
                            </button>
                            <button onClick={() => setCreating(true)} className={btn.primary}>
                                <Plus className="w-4 h-4" /> Nouveau challenge
                            </button>
                        </div>
                    </div>
                    {error && <div className="mt-4 bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-200 text-sm">{error}</div>}
                </motion.div>

                <motion.div
                    className={`${panelClass} overflow-hidden`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    {loading ? (
                        <div className="p-12 flex justify-center"><Loader name="Chargement…" /></div>
                    ) : challenges.length === 0 ? (
                        <div className="p-12 text-center text-gray-400">
                            <Trophy className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                            <p>{statusFilter ? 'Aucun challenge avec ce statut.' : 'Aucun challenge pour l’instant.'}</p>
                            {!statusFilter && <p className="text-xs mt-2">Crée le challenge du mois avec « Nouveau challenge ».</p>}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-900/50 text-gray-300">
                                    <tr>
                                        <th className="px-4 py-3 text-left">Challenge</th>
                                        <th className="px-4 py-3 text-left">Votes ouverts</th>
                                        <th className="px-4 py-3 text-left">Statut</th>
                                        <th className="px-4 py-3 text-right">Votes</th>
                                        <th className="px-4 py-3 text-right">Collecté</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {challenges.map(c => (
                                        <tr key={c._id} className="border-t border-gray-700 hover:bg-gray-700/30">
                                            <td className="px-4 py-3">
                                                <button onClick={() => navigate(`/impact-challenges/${c._id}`)} className="text-left">
                                                    <span className="block text-white font-medium hover:text-blue-300">{c.campaignName}</span>
                                                    <span className="block text-xs text-gray-400">{monthLabel(c.month, c.year)}</span>
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                                                {formatDay(c.startDate)} <span className="text-gray-500">→</span> {formatDay(c.endDate)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col items-start gap-1">
                                                    <StatusBadge status={c.status} />
                                                    {c.status === 'voting_closed' && (
                                                        <span className="text-xs text-amber-300">{c.distributionInProgress ? 'Versement en cours' : 'Fonds à distribuer'}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right text-gray-200 tabular-nums">{(c.totalVoteCount ?? 0).toLocaleString('fr-FR')}</td>
                                            <td className="px-4 py-3 text-right text-white font-mono whitespace-nowrap">{formatXaf(c.totalCollected)}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end flex-wrap gap-2">
                                                    <button onClick={() => navigate(`/impact-challenges/${c._id}`)} className={btn.smallPrimary}>Gérer</button>
                                                    {canActivate(c) && (
                                                        <button onClick={() => setPending({ kind: 'activate', challenge: c })} className={btn.smallSuccess}>Ouvrir les votes</button>
                                                    )}
                                                    {canCancel(c) && (
                                                        <button onClick={() => setPending({ kind: 'cancel', challenge: c })} className={btn.smallSecondary}>Annuler</button>
                                                    )}
                                                    {canDelete(c) && (
                                                        <button onClick={() => setPending({ kind: 'delete', challenge: c })} className={btn.smallDanger}>Supprimer</button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {totalPages > 1 && (
                        <div className="px-4 pb-4">
                            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
                        </div>
                    )}
                </motion.div>
            </main>

            {creating && (
                <ChallengeFormModal
                    onClose={() => setCreating(false)}
                    onSaved={saved => {
                        setCreating(false);
                        // Shown by the challenge page, where the admin lands.
                        navigate(`/impact-challenges/${saved._id}`, {
                            state: { flash: `« ${saved.campaignName} » est créé en brouillon. Ajoute les entrepreneurs, approuve-les, puis ouvre les votes.` },
                        });
                    }}
                />
            )}

            {pending && (() => {
                const copy = confirmCopy(pending);
                return (
                    <ConfirmationModal
                        isOpen
                        title={copy.title}
                        message={copy.message}
                        variant={copy.variant}
                        confirmText={copy.confirmText}
                        cancelText="Retour"
                        onConfirm={runPending}
                        onCancel={() => setPending(null)}
                    />
                );
            })()}

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
};

export default ImpactChallengePage;
