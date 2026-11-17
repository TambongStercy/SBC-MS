import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    ArrowLeft01Icon, Award01Icon, Calendar03Icon, Cancel01Icon, CheckmarkCircle02Icon, Delete02Icon, Edit02Icon, MoreHorizontalIcon,
    PlusSignIcon, RefreshIcon, Ticket01Icon, UserMultipleIcon, VoteIcon,
} from '@hugeicons/core-free-icons';
import { Can } from '../components/Can';
import { usePermission } from '../hooks/usePermission';
import {
    Badge, Button, EmptyState, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Metric, PageHeader, Panel, PanelBody, PanelHeader,
    Skeleton, Tabs, TabsContent, TabsList, TabsTrigger,
} from '../components/ui';
import {
    ConfirmDialog, DateText, ErrorState, Money, RankedBars, RowMenu, TodoAction, TodoPanel, formatDate, formatMoney, formatRelative, formatNumber, plural,
    type ConfirmOptions, type TodoItem,
} from '../components/moduleKit';
import { useQuery } from '@tanstack/react-query';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { fetchAnalytics } from '../components/impactChallenge/api';
import ChallengeFormModal from '../components/impactChallenge/ChallengeFormModal';
import EntrepreneurFormModal from '../components/impactChallenge/EntrepreneurFormModal';
import FundsPanel from '../components/impactChallenge/FundsPanel';
import VotesTable from '../components/impactChallenge/VotesTable';
import { payoutLegs } from '../components/impactChallenge/payout';
import { Notice, StatusBadge } from '../components/impactChallenge/shared';
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
    getChallengeDetails,
    getFundSummary,
    monthLabel,
    updateChallengeStatus,
} from '../services/impactChallengeApi';

type Tab = 'entrepreneurs' | 'leaderboard' | 'votes';
const TABS: Tab[] = ['entrepreneurs', 'leaderboard', 'votes'];

/** One Impact Challenge, from draft to payout. */
export default function ChallengeDetailsPage() {
    const { challengeId = '' } = useParams<{ challengeId: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const [params, setParams] = useSearchParams();
    const canWrite = usePermission('impactChallenge') === 'write';

    const [challenge, setChallenge] = useState<ImpactChallenge | null>(null);
    const [entrepreneurs, setEntrepreneurs] = useState<Entrepreneur[]>([]);
    const [summary, setSummary] = useState<FundSummary | null>(null);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [votesReload, setVotesReload] = useState(0);
    // Classement: voter country + vote dates (the challenge's own totals are never filtered).
    const filters = usePageFilters();
    const analyticsQuery = useQuery({
        queryKey: ['impact-challenge-analytics', challengeId, filters.apiParams, votesReload],
        queryFn: () => fetchAnalytics(challengeId, filters.apiParams),
        enabled: !!challengeId,
    });
    const analytics: ChallengeAnalytics | null = analyticsQuery.data ?? null;

    const [editingChallenge, setEditingChallenge] = useState(false);
    const [editingEntrepreneur, setEditingEntrepreneur] = useState<Entrepreneur | 'new' | null>(null);
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);

    const tabParam = params.get('tab') as Tab | null;
    const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'entrepreneurs';
    const setTab = (t: string) => setParams(prev => {
        const next = new URLSearchParams(prev);
        if (t === 'entrepreneurs') next.delete('tab'); else next.set('tab', t);
        return next;
    }, { replace: true });

    const load = useCallback(async (quiet = false) => {
        if (!quiet) setLoading(true); else setRefreshing(true);
        setLoadError(null);
        try {
            const details = await getChallengeDetails(challengeId);
            setChallenge(details.challenge);
            setEntrepreneurs(details.entrepreneurs || []);

            const showsMoney = ['active', 'voting_closed', 'funds_distributed'].includes(details.challenge.status);
            const [s] = await Promise.allSettled([
                showsMoney ? getFundSummary(challengeId) : Promise.resolve(null),
            ]);
            if (s.status === 'fulfilled') { setSummary(s.value); setSummaryError(null); }
            else { setSummary(null); setSummaryError(apiErrorMessage(s.reason, 'Impossible de calculer la répartition.')); }
        } catch (err) {
            setLoadError(apiErrorMessage(err, 'Impossible de charger ce challenge.'));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [challengeId]);

    useEffect(() => { load(); }, [load]);

    // A message handed over by the page the admin came from (e.g. "created").
    useEffect(() => {
        const flash = (location.state as { flash?: string } | null)?.flash;
        if (flash) {
            toast.success(flash);
            navigate(location.pathname + location.search, { replace: true, state: null });
        }
    }, [location.state, location.pathname, location.search, navigate]);

    const refresh = () => { load(true); setVotesReload(k => k + 1); };

    const names = useMemo(() => Object.fromEntries(entrepreneurs.map(e => [e._id, e.name])), [entrepreneurs]);
    const winner = entrepreneurs.find(e => e.isWinner);
    const sorted = useMemo(
        () => [...entrepreneurs].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.voteCount - a.voteCount),
        [entrepreneurs],
    );

    const back = (
        <Link to="/impact-challenges" className="inline-flex h-11 items-center gap-1 text-sm text-fg-muted hover:text-fg sm:h-auto">
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" /> Tous les challenges
        </Link>
    );

    if (loading && !challenge) {
        return (
            <div className="space-y-6" aria-busy="true">
                {back}
                <Skeleton className="h-8 w-72" />
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }

    if (!challenge) {
        return (
            <div className="space-y-4">
                {back}
                <Panel><ErrorState error={new Error(loadError || 'Challenge introuvable.')} onRetry={() => load()} /></Panel>
            </div>
        );
    }

    const c = challenge;
    const approvedCount = entrepreneurs.filter(e => e.approved).length;
    const toApprove = entrepreneurs.filter(e => !e.approved);
    const isOpenForChanges = c.status === 'draft' || c.status === 'active';
    const canEditEntrepreneurs = isOpenForChanges || c.status === 'voting_closed';
    const canCancel = ['draft', 'active', 'voting_closed'].includes(c.status) && (c.totalCollected ?? 0) === 0;
    const canDelete = (c.status === 'draft' || c.status === 'cancelled') && (c.totalVoteCount ?? 0) === 0;
    const showFunds = ['active', 'voting_closed', 'funds_distributed'].includes(c.status);
    const legs = payoutLegs(c, summary, winner);
    const partial = legs.some(l => l.state === 'paid');
    // What a click on "Verser" will pay: on a retry, only the parts still unpaid.
    const toPay = legs.filter(l => l.state === 'due');

    /** Runs the action, reloads, and lets ConfirmDialog show the failure. */
    const run = (fn: () => Promise<unknown>, success: string, fallback: string) => async () => {
        try {
            await fn();
            toast.success(success);
        } catch (err) {
            throw new Error(apiErrorMessage(err, fallback));
        } finally {
            refresh();
        }
    };

    const askActivate = () => setConfirm({
        title: 'Ouvrir les votes ?',
        tone: 'primary',
        confirmLabel: 'Ouvrir les votes',
        description: 'Le challenge apparaît dans l’app : les membres paient pour voter, et chaque vote leur donne aussi des tickets de la tombola du mois.',
        body: approvedCount === 0
            ? <Notice tone="warning">Aucun entrepreneur n’est approuvé : il faut en approuver au moins un avant d’ouvrir les votes.</Notice>
            : <p className="text-sm text-fg-muted">{approvedCount} {plural(approvedCount, 'entrepreneur approuvé', 'entrepreneurs approuvés')} sur {entrepreneurs.length}. Ceux qui ne sont pas approuvés n’apparaissent pas.</p>,
        onConfirm: run(() => updateChallengeStatus(c._id, 'active'), 'Les votes sont ouverts.', 'Les votes n’ont pas pu être ouverts.'),
    });
    const askClose = () => setConfirm({
        title: 'Clôturer les votes ?',
        tone: 'primary',
        confirmLabel: 'Clôturer les votes',
        description: 'Plus aucun vote n’est accepté. Les entrepreneurs approuvés sont classés par nombre de votes et le premier est désigné gagnant. C’est définitif.',
        body: <p className="text-sm text-fg-muted">Fin prévue : {formatDate(c.endDate)}. Sans action, les votes se ferment tout seuls une heure après.</p>,
        onConfirm: run(() => closeVoting(c._id), 'Votes clôturés, gagnant désigné. Vérifie la distribution des fonds.', 'Les votes n’ont pas pu être clôturés.'),
    });
    const askCancel = () => setConfirm({
        title: 'Annuler ce challenge ?',
        confirmLabel: 'Annuler le challenge',
        description: 'Le challenge s’arrête et ne pourra plus être rouvert. Rien n’a été collecté, donc personne n’est à rembourser.',
        onConfirm: run(() => updateChallengeStatus(c._id, 'cancelled'), 'Challenge annulé.', 'Le challenge n’a pas pu être annulé.'),
    });
    const askDelete = () => setConfirm({
        title: 'Supprimer ce challenge ?',
        confirmLabel: 'Supprimer',
        description: `« ${c.campaignName} » disparaît de la liste. C’est définitif. La tombola du mois reste.`,
        onConfirm: async () => {
            try {
                await deleteChallenge(c._id);
            } catch (err) {
                throw new Error(apiErrorMessage(err, 'Le challenge n’a pas pu être supprimé.'));
            }
            toast.success('Challenge supprimé.');
            navigate('/impact-challenges');
        },
    });
    const askDistribute = () => setConfirm({
        title: partial ? 'Reprendre le versement ?' : 'Distribuer les fonds ?',
        tone: 'primary',
        confirmLabel: partial ? 'Verser le reste' : 'Verser',
        description: partial ? 'Seules les parts pas encore versées seront payées.' : `Sur ${formatMoney(summary?.totalCollected ?? c.totalCollected)} collectés.`,
        body: (
            <div className="space-y-2">
                <ul className="divide-y divide-line rounded-panel border border-line text-sm">
                    {toPay.map(l => (
                        <li key={l.key} className="flex justify-between gap-3 px-3 py-2">
                            <span className="text-fg-muted">{l.label} ({l.share})</span>
                            <Money value={l.amount} className="text-fg" />
                        </li>
                    ))}
                    {toPay.length === 0 && <li className="px-3 py-2 text-fg-muted">Rien à verser : le challenge sera simplement marqué comme distribué.</li>}
                </ul>
                <p className="text-sm text-fg-muted">La part du gagnant est créditée sur le solde de son compte SBC. C’est définitif.</p>
            </div>
        ),
        onConfirm: run(() => distributeFunds(c._id), 'Fonds distribués.', 'Le versement a échoué.'),
    });
    const askApprove = (e: Entrepreneur) => setConfirm({
        title: `Approuver ${e.name} ?`,
        tone: 'primary',
        confirmLabel: 'Approuver',
        description: `Son projet apparaît dans l’app et les membres pourront voter pour lui${c.status === 'active' ? ' dès maintenant' : ' quand les votes seront ouverts'}. L’approbation ne peut pas être retirée depuis ici.`,
        onConfirm: run(() => approveEntrepreneur(e._id), `${e.name} est approuvé.`, 'L’approbation a échoué.'),
    });
    const askRemove = (e: Entrepreneur) => setConfirm({
        title: `Retirer ${e.name} ?`,
        confirmLabel: 'Retirer',
        description: 'Il n’a reçu aucun vote. Il disparaît du challenge.',
        onConfirm: run(() => deleteEntrepreneur(e._id), `${e.name} est retiré.`, 'Le retrait a échoué.'),
    });

    // The page's one main action, by stage.
    const primary = c.status === 'draft'
        ? <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={askActivate}><HugeiconsIcon icon={VoteIcon} size={18} aria-hidden="true" />Ouvrir les votes</Button>
        : c.status === 'active'
            ? <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={askClose}>Clôturer les votes</Button>
            : null;

    const todo: TodoItem[] = [];
    if (canEditEntrepreneurs && isOpenForChanges && toApprove.length) {
        todo.push({
            key: 'approve', count: toApprove.length,
            label: `${plural(toApprove.length, 'Entrepreneur')} à approuver`,
            hint: toApprove.map(e => e.name).join(', '),
            action: canWrite && toApprove.length === 1
                ? <TodoAction onClick={() => askApprove(toApprove[0])}>Approuver</TodoAction>
                : <TodoAction onClick={() => setTab('entrepreneurs')}>Voir</TodoAction>,
        });
    }
    if (c.status === 'voting_closed' && !c.distributionInProgress) {
        todo.push({
            key: 'pay', count: 1,
            label: partial ? 'Versement à reprendre' : 'Fonds à distribuer',
            hint: `${formatMoney(summary?.totalCollected ?? c.totalCollected)} collectés`,
            action: canWrite ? <TodoAction onClick={askDistribute}>{partial ? 'Reprendre' : 'Distribuer'}</TodoAction> : undefined,
        });
    }
    if (c.status === 'voting_closed' && winner && !winner.userId) {
        todo.push({
            key: 'winner', count: 1, tone: 'danger',
            label: `${winner.name} n’a pas de compte SBC lié`,
            hint: 'Sans compte lié, sa part ne peut pas être versée.',
            action: canWrite ? <TodoAction onClick={() => setEditingEntrepreneur(winner)}>Lier son compte</TodoAction> : undefined,
        });
    }
    const showTodo = c.status !== 'cancelled' && c.status !== 'funds_distributed';

    return (
        <div className="space-y-6">
            <div>
                {back}
                <PageHeader
                    className="mb-0 mt-2"
                    title={<span className="flex flex-wrap items-center gap-3">{c.campaignName}<StatusBadge status={c.status} /></span>}
                    description={`${monthLabel(c.month, c.year)} · votes du ${formatDate(c.startDate)} au ${formatDate(c.endDate)}`}
                    actions={(
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                            {primary && <Can module="impactChallenge" write>{primary}</Can>}
                            <div className="flex gap-2">
                                <Can module="impactChallenge" write>
                                    {isOpenForChanges && (
                                        <Button variant="outline" size="lg" className="flex-1 sm:flex-none" onClick={() => setEditingChallenge(true)}>
                                            <HugeiconsIcon icon={Edit02Icon} size={16} aria-hidden="true" />Modifier
                                        </Button>
                                    )}
                                </Can>
                                <Menu>
                                    <MenuTrigger asChild>
                                        <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Plus d’actions">
                                            <HugeiconsIcon icon={MoreHorizontalIcon} size={18} aria-hidden="true" />
                                        </Button>
                                    </MenuTrigger>
                                    <MenuContent>
                                        <MenuItem onSelect={refresh}><HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />Rafraîchir</MenuItem>
                                        <MenuItem onSelect={() => navigate(`/tombola/draw/${c.tombolaMonthId}`)}><HugeiconsIcon icon={Ticket01Icon} size={16} aria-hidden="true" />Voir la tombola du mois</MenuItem>
                                        {canWrite && (canCancel || canDelete) && <MenuSeparator />}
                                        {canWrite && canCancel && <MenuItem onSelect={askCancel}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />Annuler le challenge</MenuItem>}
                                        {canWrite && canDelete && <MenuItem destructive onSelect={askDelete}><HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />Supprimer</MenuItem>}
                                    </MenuContent>
                                </Menu>
                            </div>
                        </div>
                    )}
                />
            </div>

            {showTodo && <TodoPanel items={todo} />}

            {(c.lateCollected ?? 0) > 0 && (
                <Notice tone="warning">
                    <strong>{formatMoney(c.lateCollected)}</strong> ont été payés après la clôture des votes. Cet argent est gardé, mais il ne compte ni dans
                    le classement ni dans la répartition des fonds. Ces paiements sont marqués « Payé après la clôture » dans la liste des votes.
                </Notice>
            )}

            <div className={`grid grid-cols-2 gap-3 lg:grid-cols-4 ${refreshing ? 'opacity-60' : ''}`}>
                <Metric label="Collecté" value={<Money value={c.totalCollected} />} hint={approvedCount ? `sur ${approvedCount} ${plural(approvedCount, 'projet')}` : undefined} />
                <Metric label="Votes" icon={VoteIcon} value={formatNumber(c.totalVoteCount ?? 0)} />
                <Metric label="Entrepreneurs approuvés" icon={UserMultipleIcon} value={`${approvedCount} / ${entrepreneurs.length}`} hint={`${MAX_ENTREPRENEURS} au maximum`} />
                <Metric label="Fin des votes" icon={Calendar03Icon} value={<span className="text-lg">{formatDate(c.endDate)}</span>} hint={formatRelative(c.endDate) !== formatDate(c.endDate) ? <DateText value={c.endDate} /> : undefined} />
            </div>

            {showFunds && (
                <FundsPanel
                    challenge={c}
                    summary={summary}
                    summaryError={summaryError}
                    winner={winner}
                    onDistribute={askDistribute}
                    onLinkWinner={e => setEditingEntrepreneur(e)}
                    onRefresh={refresh}
                />
            )}

            <Tabs value={tab} onValueChange={setTab}>
                {tab !== 'entrepreneurs' && (
                    <div className="mb-3 flex flex-col gap-1">
                        <PageFilters filters={filters} className="mb-0" />
                        <p className="text-xs text-fg-muted">Le pays (celui du votant) et la période filtrent le classement et la liste des votes. Les totaux et la répartition restent ceux du challenge entier.</p>
                    </div>
                )}
                <TabsList>
                    <TabsTrigger value="entrepreneurs" className="h-11">Entrepreneurs ({entrepreneurs.length})</TabsTrigger>
                    <TabsTrigger value="leaderboard" className="h-11">Classement</TabsTrigger>
                    <TabsTrigger value="votes" className="h-11">Votes ({formatNumber(c.totalVoteCount ?? 0)})</TabsTrigger>
                </TabsList>

                <TabsContent value="entrepreneurs" className="mt-4 space-y-4">
                    {isOpenForChanges && (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-fg-muted">
                                {MAX_ENTREPRENEURS} entrepreneurs au maximum. Un entrepreneur n’apparaît dans l’app qu’une fois approuvé.
                            </p>
                            <Can module="impactChallenge" write>
                                <Button
                                    variant="outline"
                                    size="lg"
                                    onClick={() => setEditingEntrepreneur('new')}
                                    disabled={entrepreneurs.length >= MAX_ENTREPRENEURS}
                                    title={entrepreneurs.length >= MAX_ENTREPRENEURS ? `${MAX_ENTREPRENEURS} entrepreneurs au maximum` : undefined}
                                >
                                    <HugeiconsIcon icon={PlusSignIcon} size={16} aria-hidden="true" /> Ajouter un entrepreneur
                                </Button>
                            </Can>
                        </div>
                    )}
                    {sorted.length === 0 ? (
                        <Panel>
                            <EmptyState
                                icon={UserMultipleIcon}
                                title="Aucun entrepreneur pour l’instant"
                                description={isOpenForChanges ? `Ajoutez jusqu’à ${MAX_ENTREPRENEURS} entrepreneurs, avec leur vidéo de présentation.` : undefined}
                            />
                        </Panel>
                    ) : (
                        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                            {sorted.map(e => (
                                <EntrepreneurCard
                                    key={e._id}
                                    e={e}
                                    canWrite={canWrite && canEditEntrepreneurs}
                                    canApprove={isOpenForChanges && !e.approved}
                                    canRemove={isOpenForChanges && e.voteCount === 0}
                                    editLabel={c.status === 'voting_closed' ? 'Modifier / lier son compte' : 'Modifier'}
                                    onApprove={() => askApprove(e)}
                                    onEdit={() => setEditingEntrepreneur(e)}
                                    onRemove={() => askRemove(e)}
                                />
                            ))}
                        </div>
                    )}
                    {(c.description?.fr || c.description?.en) && (
                        <Panel>
                            <PanelHeader title="Description du challenge" description="Ce que les membres lisent sur la page du challenge." />
                            <PanelBody className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <p className="mb-1 text-xs font-medium text-fg-subtle">Français</p>
                                    <p className="whitespace-pre-line text-sm text-fg-muted">{c.description?.fr || '—'}</p>
                                </div>
                                <div>
                                    <p className="mb-1 text-xs font-medium text-fg-subtle">Anglais</p>
                                    <p className="whitespace-pre-line text-sm text-fg-muted">{c.description?.en || '—'}</p>
                                </div>
                            </PanelBody>
                        </Panel>
                    )}
                </TabsContent>

                <TabsContent value="leaderboard" className="mt-4">
                    <Panel>
                        <PanelHeader
                            title="Classement"
                            description={`Entrepreneurs approuvés, du plus voté au moins voté (part des votes).${c.status === 'active' ? ' Le classement bouge tant que les votes sont ouverts.' : ''}`}
                        />
                        <PanelBody>
                            {!analytics ? (
                                <p className="text-sm text-fg-muted">Classement indisponible pour l’instant.</p>
                            ) : (
                                <RankedBars
                                    emptyText="Aucun vote pour l’instant."
                                    items={analytics.entrepreneurBreakdown.map((row, i) => ({
                                        key: row.entrepreneurId,
                                        label: `${i + 1}. ${row.name}${winner?._id === row.entrepreneurId ? ' (gagnant)' : ''} · ${formatMoney(row.totalAmount)}`,
                                        value: row.voteCount,
                                    }))}
                                />
                            )}
                        </PanelBody>
                    </Panel>
                </TabsContent>

                <TabsContent value="votes" className="mt-4">
                    <Panel>
                        <VotesTable challengeId={c._id} entrepreneurNames={names} reloadKey={votesReload} filterParams={filters.apiParams} />
                    </Panel>
                </TabsContent>
            </Tabs>

            {editingChallenge && (
                <ChallengeFormModal
                    challenge={c}
                    onClose={() => setEditingChallenge(false)}
                    onSaved={() => {
                        setEditingChallenge(false);
                        toast.success('Challenge modifié.');
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
                        toast.success(isNew ? `${saved.name} est ajouté. Approuve-le pour qu’il apparaisse dans l’app.` : `${saved.name} est modifié.`);
                        load(true);
                    }}
                />
            )}

            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}

function EntrepreneurCard({ e, canWrite, canApprove, canRemove, editLabel, onApprove, onEdit, onRemove }: {
    e: Entrepreneur;
    canWrite: boolean;
    canApprove: boolean;
    canRemove: boolean;
    editLabel: string;
    onApprove: () => void;
    onEdit: () => void;
    onRemove: () => void;
}) {
    return (
        <Panel className="flex flex-col gap-3 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-semibold text-fg">
                        {e.isWinner && <HugeiconsIcon icon={Award01Icon} size={16} aria-label="Gagnant" className="shrink-0 text-warning" />}
                        <span className="truncate">{e.name}</span>
                    </p>
                    <p className="text-sm text-fg-muted">{e.projectName}</p>
                    <p className="text-xs text-fg-muted">{e.businessCategory} · {e.city}, {getCountryName(e.country) || e.country}</p>
                </div>
                {e.approved
                    ? <Badge tone="success"><HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} aria-hidden="true" />Approuvé</Badge>
                    : <Badge tone="warning">À approuver</Badge>}
            </div>

            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                <span className="text-fg"><b className="tabular-nums">{formatNumber(e.voteCount)}</b> {plural(e.voteCount, 'vote')}</span>
                <Money value={e.totalAmount} className="text-fg" />
                {e.rank ? <span className="text-fg-muted">{e.rank === 1 ? '1er' : `${e.rank}e`}</span> : null}
            </div>

            <div className="space-y-0.5 text-xs text-fg-muted">
                <p className="break-all">{e.email} · {e.phoneNumber}</p>
                {e.userId
                    ? <p>Compte SBC lié · <Link to={`/userpage/${e.userId}`} className="text-primary hover:underline">voir la fiche</Link></p>
                    : <p className="text-danger">Pas de compte SBC lié : s’il gagne, il ne pourra pas être payé.</p>}
            </div>

            {e.videoUrl && (
                <video src={e.videoUrl} controls playsInline preload="none" poster={e.videoThumbnailUrl}
                    className="max-h-60 w-full rounded-panel border border-line bg-black" />
            )}
            {e.projectDescription?.fr && (
                <p className="line-clamp-4 whitespace-pre-line text-sm text-fg-muted" title={e.projectDescription.fr}>{e.projectDescription.fr}</p>
            )}

            {canWrite && (
                <div className="mt-auto flex items-center gap-2 pt-1">
                    {canApprove
                        ? <Button variant="primary" size="lg" className="flex-1 sm:h-9 sm:flex-none" onClick={onApprove}>Approuver</Button>
                        : <Button variant="outline" size="lg" className="flex-1 sm:h-9 sm:flex-none" onClick={onEdit}>{editLabel}</Button>}
                    {(canApprove || canRemove) && (
                        <RowMenu>
                            {canApprove && <MenuItem onSelect={onEdit}><HugeiconsIcon icon={Edit02Icon} size={16} aria-hidden="true" />{editLabel}</MenuItem>}
                            {canRemove && <MenuItem destructive onSelect={onRemove}><HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />Retirer</MenuItem>}
                        </RowMenu>
                    )}
                </div>
            )}
        </Panel>
    );
}

