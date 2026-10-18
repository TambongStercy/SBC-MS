import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Banknote, CalendarClock, Pencil, Plus, RefreshCw, Trophy, Users, Vote } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import StatCard from '../components/common/statCard';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import ChallengeFormModal from '../components/impactChallenge/ChallengeFormModal';
import EntrepreneurFormModal from '../components/impactChallenge/EntrepreneurFormModal';
import FundsPanel from '../components/impactChallenge/FundsPanel';
import VotesTable from '../components/impactChallenge/VotesTable';
import { payoutLegs } from '../components/impactChallenge/payout';
import { Notice, StatusBadge } from '../components/impactChallenge/shared';
import { btn, panelClass } from '../components/impactChallenge/styles';
import { getCountryName } from '../utils/countryUtils';
import {
    ChallengeAnalytics,
    Entrepreneur,
    FundSummary,
    ImpactChallenge,
    MAX_ENTREPRENEURS,
    apiErrorMessage,
    approveEntrepreneur,
    closeVoting,
    deleteChallenge,
    deleteEntrepreneur,
    distributeFunds,
    formatDay,
    formatXaf,
    getChallengeAnalytics,
    getChallengeDetails,
    getFundSummary,
    monthLabel,
    updateChallengeStatus,
} from '../services/impactChallengeApi';

type Tab = 'entrepreneurs' | 'leaderboard' | 'votes';
type Action = 'activate' | 'close' | 'cancel' | 'delete' | 'distribute';

/** One Impact Challenge, from draft to payout. */
const ChallengeDetailsPage: React.FC = () => {
    const { challengeId = '' } = useParams<{ challengeId: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const { toasts, removeToast, showSuccess, showError } = useToast();

    const [challenge, setChallenge] = useState<ImpactChallenge | null>(null);
    const [entrepreneurs, setEntrepreneurs] = useState<Entrepreneur[]>([]);
    const [summary, setSummary] = useState<FundSummary | null>(null);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [analytics, setAnalytics] = useState<ChallengeAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>('entrepreneurs');
    const [votesReload, setVotesReload] = useState(0);

    const [editingChallenge, setEditingChallenge] = useState(false);
    const [editingEntrepreneur, setEditingEntrepreneur] = useState<Entrepreneur | 'new' | null>(null);
    const [action, setAction] = useState<Action | null>(null);
    const [entAction, setEntAction] = useState<{ kind: 'approve' | 'delete'; e: Entrepreneur } | null>(null);

    const load = useCallback(async (quiet = false) => {
        if (!quiet) setLoading(true);
        setLoadError(null);
        try {
            const details = await getChallengeDetails(challengeId);
            setChallenge(details.challenge);
            setEntrepreneurs(details.entrepreneurs || []);

            const showsMoney = ['active', 'voting_closed', 'funds_distributed'].includes(details.challenge.status);
            const [s, a] = await Promise.allSettled([
                showsMoney ? getFundSummary(challengeId) : Promise.resolve(null),
                getChallengeAnalytics(challengeId),
            ]);
            if (s.status === 'fulfilled') { setSummary(s.value); setSummaryError(null); }
            else { setSummary(null); setSummaryError(apiErrorMessage(s.reason, 'Impossible de calculer la répartition.')); }
            setAnalytics(a.status === 'fulfilled' ? a.value : null);
        } catch (err) {
            setLoadError(apiErrorMessage(err, 'Impossible de charger ce challenge.'));
        } finally {
            setLoading(false);
        }
    }, [challengeId]);

    useEffect(() => { load(); }, [load]);

    // A message handed over by the page the admin came from (e.g. "created").
    useEffect(() => {
        const flash = (location.state as { flash?: string } | null)?.flash;
        if (flash) {
            showSuccess(flash);
            navigate(location.pathname, { replace: true, state: null });
        }
    }, [location.state, location.pathname, navigate, showSuccess]);

    const refresh = () => { load(true); setVotesReload(k => k + 1); };

    const names = useMemo(() => Object.fromEntries(entrepreneurs.map(e => [e._id, e.name])), [entrepreneurs]);
    const winner = entrepreneurs.find(e => e.isWinner);
    const sorted = useMemo(
        () => [...entrepreneurs].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.voteCount - a.voteCount),
        [entrepreneurs],
    );

    if (loading && !challenge) {
        return (
            <div className="flex-1 overflow-auto relative z-10">
                <Header title="Impact Challenge" />
                <div className="p-12 flex justify-center"><Loader name="Chargement…" /></div>
            </div>
        );
    }

    if (!challenge) {
        return (
            <div className="flex-1 overflow-auto relative z-10">
                <Header title="Impact Challenge" />
                <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8 space-y-4">
                    <Link to="/impact-challenges" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200">
                        <ArrowLeft className="w-4 h-4" /> Tous les challenges
                    </Link>
                    <Notice tone="danger">{loadError || 'Challenge introuvable.'}</Notice>
                    <button onClick={() => load()} className={btn.secondary}><RefreshCw className="w-4 h-4" /> Réessayer</button>
                </main>
            </div>
        );
    }

    const c = challenge;
    const approvedCount = entrepreneurs.filter(e => e.approved).length;
    const isOpenForChanges = c.status === 'draft' || c.status === 'active';
    const canEditEntrepreneurs = isOpenForChanges || c.status === 'voting_closed';
    const canCancel = ['draft', 'active', 'voting_closed'].includes(c.status) && (c.totalCollected ?? 0) === 0;
    const canDelete = (c.status === 'draft' || c.status === 'cancelled') && (c.totalVoteCount ?? 0) === 0;
    const showFunds = ['active', 'voting_closed', 'funds_distributed'].includes(c.status);
    const legs = payoutLegs(c, summary, winner);
    const partial = legs.some(l => l.state === 'paid');
    // What a click on "Verser" will pay: on a retry, only the parts still unpaid.
    const toPay = legs.filter(l => l.state === 'due');

    const run = async (fn: () => Promise<void>, fallback: string) => {
        try {
            await fn();
        } catch (err) {
            showError(apiErrorMessage(err, fallback));
        } finally {
            setAction(null);
            setEntAction(null);
            load(true);
        }
    };

    const confirmations: Record<Action, { title: string; variant: 'danger' | 'success' | 'primary'; confirmText: string; message: React.ReactNode; onConfirm: () => Promise<void> }> = {
        activate: {
            title: 'Ouvrir les votes ?',
            variant: 'success',
            confirmText: 'Ouvrir les votes',
            message: (
                <div className="space-y-2 text-sm">
                    <p>Le challenge apparaît dans l’app : les membres paient pour voter, et chaque vote leur donne aussi des tickets de la tombola du mois.</p>
                    {approvedCount === 0
                        ? <p className="text-amber-300">Aucun entrepreneur n’est approuvé : il faut en approuver au moins un avant d’ouvrir les votes.</p>
                        : <p className="text-gray-400">{approvedCount} entrepreneur{approvedCount > 1 ? 's' : ''} approuvé{approvedCount > 1 ? 's' : ''} sur {entrepreneurs.length}. Ceux qui ne sont pas approuvés n’apparaissent pas.</p>}
                </div>
            ),
            onConfirm: () => run(async () => {
                await updateChallengeStatus(c._id, 'active');
                showSuccess('Les votes sont ouverts.');
            }, 'Les votes n’ont pas pu être ouverts.'),
        },
        close: {
            title: 'Clôturer les votes ?',
            variant: 'primary',
            confirmText: 'Clôturer les votes',
            message: (
                <div className="space-y-2 text-sm">
                    <p>Plus aucun vote n’est accepté. Les entrepreneurs approuvés sont classés par nombre de votes et le premier est désigné gagnant. C’est définitif.</p>
                    <p className="text-gray-400">Fin prévue : {formatDay(c.endDate)}. Sans action, les votes se ferment tout seuls une heure après.</p>
                </div>
            ),
            onConfirm: () => run(async () => {
                await closeVoting(c._id);
                showSuccess('Votes clôturés, gagnant désigné. Vérifie la distribution des fonds.');
            }, 'Les votes n’ont pas pu être clôturés.'),
        },
        cancel: {
            title: 'Annuler ce challenge ?',
            variant: 'danger',
            confirmText: 'Annuler le challenge',
            message: <p className="text-sm">Le challenge s’arrête et ne pourra plus être rouvert. Rien n’a été collecté, donc personne n’est à rembourser.</p>,
            onConfirm: () => run(async () => {
                await updateChallengeStatus(c._id, 'cancelled');
                showSuccess('Challenge annulé.');
            }, 'Le challenge n’a pas pu être annulé.'),
        },
        delete: {
            title: 'Supprimer ce challenge ?',
            variant: 'danger',
            confirmText: 'Supprimer',
            message: <p className="text-sm">« {c.campaignName} » disparaît de la liste. C’est définitif. La tombola du mois reste.</p>,
            onConfirm: async () => {
                try {
                    await deleteChallenge(c._id);
                    navigate('/impact-challenges');
                } catch (err) {
                    showError(apiErrorMessage(err, 'Le challenge n’a pas pu être supprimé.'));
                    setAction(null);
                }
            },
        },
        distribute: {
            title: partial ? 'Reprendre le versement ?' : 'Distribuer les fonds ?',
            variant: 'success',
            confirmText: partial ? 'Verser le reste' : 'Verser',
            message: (
                <div className="space-y-2 text-sm">
                    <p>{partial ? 'Seules les parts pas encore versées seront payées :' : `Sur ${formatXaf(summary?.totalCollected ?? c.totalCollected)} collectés :`}</p>
                    <ul className="bg-gray-900/50 rounded-lg divide-y divide-gray-700">
                        {toPay.map(l => (
                            <li key={l.key} className="flex justify-between gap-3 px-3 py-1.5">
                                <span className="text-gray-300">{l.label} ({l.share})</span>
                                <span className="text-white font-mono whitespace-nowrap">{formatXaf(l.amount)}</span>
                            </li>
                        ))}
                        {toPay.length === 0 && <li className="px-3 py-1.5 text-gray-400">Rien à verser : le challenge sera simplement marqué comme distribué.</li>}
                    </ul>
                    <p className="text-gray-400">La part du gagnant est créditée sur le solde de son compte SBC. C’est définitif.</p>
                </div>
            ),
            onConfirm: () => run(async () => {
                await distributeFunds(c._id);
                showSuccess('Fonds distribués.');
            }, 'Le versement a échoué.'),
        },
    };

    const confirm = action ? confirmations[action] : null;

    return (
        <div className="flex-1 overflow-auto relative z-10">
            <Header title="Impact Challenge" />
            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                <Link to="/impact-challenges" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 mb-4">
                    <ArrowLeft className="w-4 h-4" /> Tous les challenges
                </Link>

                <motion.div
                    className={`${panelClass} p-6 mb-6`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-3">
                                <h2 className="text-2xl font-semibold text-gray-100">{c.campaignName}</h2>
                                <StatusBadge status={c.status} />
                            </div>
                            <p className="text-sm text-gray-400 mt-1">
                                {monthLabel(c.month, c.year)} · votes du {formatDay(c.startDate)} au {formatDay(c.endDate)}
                            </p>
                            <Link to={`/tombola/draw/${c.tombolaMonthId}`} className="inline-block mt-1 text-sm text-blue-300 hover:text-blue-200">
                                Voir la tombola du mois
                            </Link>
                        </div>
                        <div className="flex flex-wrap gap-2 shrink-0">
                            <button onClick={refresh} className={btn.secondary}><RefreshCw className="w-4 h-4" /> Rafraîchir</button>
                            {isOpenForChanges && (
                                <button onClick={() => setEditingChallenge(true)} className={btn.secondary}><Pencil className="w-4 h-4" /> Modifier</button>
                            )}
                            {c.status === 'draft' && <button onClick={() => setAction('activate')} className={btn.success}>Ouvrir les votes</button>}
                            {c.status === 'active' && <button onClick={() => setAction('close')} className={btn.warning}>Clôturer les votes</button>}
                            {canCancel && <button onClick={() => setAction('cancel')} className={btn.secondary}>Annuler</button>}
                            {canDelete && <button onClick={() => setAction('delete')} className={btn.danger}>Supprimer</button>}
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4 mt-5">
                        <div>
                            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Description (français)</p>
                            <p className="text-sm text-gray-300 whitespace-pre-line">{c.description?.fr || '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Description (anglais)</p>
                            <p className="text-sm text-gray-300 whitespace-pre-line">{c.description?.en || '—'}</p>
                        </div>
                    </div>
                </motion.div>

                {(c.lateCollected ?? 0) > 0 && (
                    <Notice tone="warning" className="mb-6">
                        <strong>{formatXaf(c.lateCollected)}</strong> ont été payés après la clôture des votes. Cet argent est gardé, mais il ne compte ni dans
                        le classement ni dans la répartition des fonds. Ces paiements sont marqués « Payé après la clôture » dans la liste des votes.
                    </Notice>
                )}

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <StatCard name="Collecté" icon={Banknote} value={formatXaf(c.totalCollected)} color="#10b981" />
                    <StatCard name="Votes" icon={Vote} value={(c.totalVoteCount ?? 0).toLocaleString('fr-FR')} color="#3b82f6" />
                    <StatCard name="Entrepreneurs approuvés" icon={Users} value={`${approvedCount} / ${entrepreneurs.length}`} color="#8b5cf6" />
                    <StatCard name="Fin des votes" icon={CalendarClock} value={formatDay(c.endDate)} color="#f59e0b" />
                </div>

                {showFunds && (
                    <FundsPanel
                        challenge={c}
                        summary={summary}
                        summaryError={summaryError}
                        winner={winner}
                        onDistribute={() => setAction('distribute')}
                        onLinkWinner={e => setEditingEntrepreneur(e)}
                        onRefresh={refresh}
                    />
                )}

                <div className="border-b border-gray-700 flex gap-1 mb-4 overflow-x-auto">
                    {([
                        ['entrepreneurs', `Entrepreneurs (${entrepreneurs.length})`],
                        ['leaderboard', 'Classement'],
                        ['votes', `Votes (${(c.totalVoteCount ?? 0).toLocaleString('fr-FR')})`],
                    ] as Array<[Tab, string]>).map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            className={`px-5 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                                tab === key ? 'border-amber-500 text-amber-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {tab === 'entrepreneurs' && (
                    <div className="space-y-4">
                        {isOpenForChanges && (
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm text-gray-400">
                                    {MAX_ENTREPRENEURS} entrepreneurs au maximum. Un entrepreneur n’apparaît dans l’app qu’une fois approuvé.
                                </p>
                                <button
                                    onClick={() => setEditingEntrepreneur('new')}
                                    disabled={entrepreneurs.length >= MAX_ENTREPRENEURS}
                                    className={btn.primary}
                                    title={entrepreneurs.length >= MAX_ENTREPRENEURS ? `${MAX_ENTREPRENEURS} entrepreneurs au maximum` : undefined}
                                >
                                    <Plus className="w-4 h-4" /> Ajouter un entrepreneur
                                </button>
                            </div>
                        )}
                        {sorted.length === 0 ? (
                            <div className={`${panelClass} p-12 text-center text-gray-400`}>
                                <Users className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                                <p>Aucun entrepreneur pour l’instant.</p>
                                {isOpenForChanges && <p className="text-xs mt-2">Ajoute jusqu’à {MAX_ENTREPRENEURS} entrepreneurs, avec leur vidéo de présentation.</p>}
                            </div>
                        ) : (
                            <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-4">
                                {sorted.map(e => (
                                    <div key={e._id} className={`${panelClass} p-5 flex flex-col gap-3`}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-white font-semibold flex items-center gap-1.5">
                                                    {e.isWinner && <Trophy className="w-4 h-4 text-amber-400 shrink-0" />}
                                                    <span className="truncate">{e.name}</span>
                                                </p>
                                                <p className="text-sm text-gray-300">{e.projectName}</p>
                                                <p className="text-xs text-gray-400">
                                                    {e.businessCategory} · {e.city}, {getCountryName(e.country) || e.country}
                                                </p>
                                            </div>
                                            {e.approved
                                                ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-900/60 text-green-300 shrink-0">Approuvé</span>
                                                : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-900/60 text-yellow-300 shrink-0">À approuver</span>}
                                        </div>

                                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                            <span className="text-gray-200"><b className="tabular-nums">{e.voteCount.toLocaleString('fr-FR')}</b> votes</span>
                                            <span className="text-gray-200 font-mono">{formatXaf(e.totalAmount)}</span>
                                            {e.rank && <span className="text-gray-400">{e.rank === 1 ? '1er' : `${e.rank}e`}</span>}
                                        </div>

                                        <div className="text-xs text-gray-400 space-y-0.5">
                                            <p className="break-all">{e.email} · {e.phoneNumber}</p>
                                            {e.userId
                                                ? <p className="text-green-300">Compte SBC lié <Link to={`/userpage/${e.userId}`} className="text-blue-300 hover:text-blue-200">(voir)</Link></p>
                                                : <p className="text-amber-300">Pas de compte SBC lié : s’il gagne, il ne pourra pas être payé.</p>}
                                        </div>

                                        {e.videoUrl && (
                                            <video src={e.videoUrl} controls playsInline preload="none" poster={e.videoThumbnailUrl}
                                                className="w-full max-h-60 rounded-xl bg-black border border-gray-700" />
                                        )}
                                        {e.projectDescription?.fr && (
                                            <p className="text-sm text-gray-300 whitespace-pre-line line-clamp-4" title={e.projectDescription.fr}>{e.projectDescription.fr}</p>
                                        )}

                                        {canEditEntrepreneurs && (
                                            <div className="flex flex-wrap gap-2 mt-auto pt-1">
                                                {isOpenForChanges && !e.approved && (
                                                    <button onClick={() => setEntAction({ kind: 'approve', e })} className={btn.smallSuccess}>Approuver</button>
                                                )}
                                                <button onClick={() => setEditingEntrepreneur(e)} className={btn.smallSecondary}>
                                                    {c.status === 'voting_closed' ? 'Modifier / lier son compte' : 'Modifier'}
                                                </button>
                                                {isOpenForChanges && e.voteCount === 0 && (
                                                    <button onClick={() => setEntAction({ kind: 'delete', e })} className={btn.smallDanger}>Retirer</button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {tab === 'leaderboard' && (
                    <div className={`${panelClass} p-6`}>
                        <p className="text-sm text-gray-400 mb-4">
                            Entrepreneurs approuvés, du plus voté au moins voté. {c.status === 'active' ? 'Le classement bouge tant que les votes sont ouverts.' : ''}
                        </p>
                        {!analytics ? (
                            <p className="text-gray-400 text-sm">Classement indisponible pour l’instant.</p>
                        ) : analytics.entrepreneurBreakdown.length === 0 ? (
                            <p className="text-gray-400 text-sm">Aucun entrepreneur approuvé.</p>
                        ) : (
                            <ol className="space-y-4">
                                {analytics.entrepreneurBreakdown.map((row, i) => {
                                    const share = analytics.totalVotes > 0 ? Math.round((row.voteCount / analytics.totalVotes) * 100) : 0;
                                    return (
                                        <li key={row.entrepreneurId}>
                                            <div className="flex items-baseline justify-between gap-3 mb-1">
                                                <span className="text-gray-100">
                                                    <span className="text-gray-500 mr-2">{i + 1}.</span>{row.name}
                                                    {winner?._id === row.entrepreneurId && <Trophy className="inline w-4 h-4 text-amber-400 ml-1.5 -mt-0.5" />}
                                                </span>
                                                <span className="text-sm text-gray-300 whitespace-nowrap">
                                                    {row.voteCount.toLocaleString('fr-FR')} votes · <span className="font-mono">{formatXaf(row.totalAmount)}</span> · {share} %
                                                </span>
                                            </div>
                                            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                                                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${share}%` }} />
                                            </div>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </div>
                )}

                {tab === 'votes' && (
                    <div className={`${panelClass} p-6`}>
                        <VotesTable challengeId={c._id} entrepreneurNames={names} reloadKey={votesReload} />
                    </div>
                )}
            </main>

            {editingChallenge && (
                <ChallengeFormModal
                    challenge={c}
                    onClose={() => setEditingChallenge(false)}
                    onSaved={() => {
                        setEditingChallenge(false);
                        showSuccess('Challenge modifié.');
                        load(true);
                    }}
                />
            )}

            {editingEntrepreneur && (
                <EntrepreneurFormModal
                    challengeId={c._id}
                    entrepreneur={editingEntrepreneur === 'new' ? undefined : editingEntrepreneur}
                    onClose={() => setEditingEntrepreneur(null)}
                    onSaved={(saved, isNew) => {
                        setEditingEntrepreneur(null);
                        showSuccess(isNew ? `${saved.name} est ajouté. Approuve-le pour qu’il apparaisse dans l’app.` : `${saved.name} est modifié.`);
                        load(true);
                    }}
                />
            )}

            {confirm && (
                <ConfirmationModal
                    isOpen
                    title={confirm.title}
                    message={confirm.message}
                    variant={confirm.variant}
                    confirmText={confirm.confirmText}
                    cancelText="Retour"
                    onConfirm={confirm.onConfirm}
                    onCancel={() => setAction(null)}
                />
            )}

            {entAction && (
                <ConfirmationModal
                    isOpen
                    title={entAction.kind === 'approve' ? `Approuver ${entAction.e.name} ?` : `Retirer ${entAction.e.name} ?`}
                    variant={entAction.kind === 'approve' ? 'success' : 'danger'}
                    confirmText={entAction.kind === 'approve' ? 'Approuver' : 'Retirer'}
                    cancelText="Retour"
                    message={entAction.kind === 'approve'
                        ? <p className="text-sm">Son projet apparaît dans l’app et les membres pourront voter pour lui{c.status === 'active' ? ' dès maintenant' : ' quand les votes seront ouverts'}. L’approbation ne peut pas être retirée depuis ici.</p>
                        : <p className="text-sm">Il n’a reçu aucun vote. Il disparaît du challenge.</p>}
                    onConfirm={() => run(async () => {
                        if (entAction.kind === 'approve') {
                            await approveEntrepreneur(entAction.e._id);
                            showSuccess(`${entAction.e.name} est approuvé.`);
                        } else {
                            await deleteEntrepreneur(entAction.e._id);
                            showSuccess(`${entAction.e.name} est retiré.`);
                        }
                    }, entAction.kind === 'approve' ? 'L’approbation a échoué.' : 'Le retrait a échoué.')}
                    onCancel={() => setEntAction(null)}
                />
            )}

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
};

export default ChallengeDetailsPage;
