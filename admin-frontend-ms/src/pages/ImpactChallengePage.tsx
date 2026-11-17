import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Award01Icon, Cancel01Icon, Delete02Icon, PlusSignIcon, VoteIcon } from '@hugeicons/core-free-icons';
import { Can } from '../components/Can';
import { usePermission } from '../hooks/usePermission';
import { Button, EmptyState, MenuItem, Metric, PageHeader, Pagination, Panel, PanelHeader, ResponsiveList, Skeleton, type ListColumn } from '../components/ui';
import {
    ConfirmDialog, DateText, ErrorState, FilterSelect, Money, RowMenu, TodoAction, TodoPanel, formatDate, formatNumber, plural,
    useUrlFilters, type ConfirmOptions, type TodoItem,
} from '../components/moduleKit';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { countryOnly, fetchChallenges, type AdminFilterParams } from '../components/impactChallenge/api';
import ChallengeFormModal from '../components/impactChallenge/ChallengeFormModal';
import { StatusBadge } from '../components/impactChallenge/shared';
import {
    ChallengeStatus,
    ImpactChallenge,
    STATUS_LABELS,
    apiErrorMessage,
    deleteChallenge,
    getChallengeDetails,
    monthLabel,
    updateChallengeStatus,
} from '../services/impactChallengeApi';

const PAGE_SIZE = 10;
const KEY = ['impact-challenges'] as const;
const FILTER_KEYS = ['status'] as const;

/** What the service allows, so the actions offered are the ones that will work. */
const canActivate = (c: ImpactChallenge) => c.status === 'draft';
const canCancel = (c: ImpactChallenge) =>
    ['draft', 'active', 'voting_closed'].includes(c.status) && (c.totalCollected ?? 0) === 0;
const canDelete = (c: ImpactChallenge) => (c.status === 'draft' || c.status === 'cancelled') && (c.totalVoteCount ?? 0) === 0;

/**
 * What needs the admin across all challenges: funds to distribute, and
 * entrepreneurs waiting for approval on drafts / open challenges (read from
 * each challenge's details: the list does not carry them).
 */
async function loadWork(f: AdminFilterParams) {
    const [closed, drafts, active] = await Promise.all([
        fetchChallenges(1, 20, 'voting_closed', f),
        fetchChallenges(1, 20, 'draft', f),
        fetchChallenges(1, 5, 'active', f),
    ]);
    const open = [...(drafts.challenges || []), ...(active.challenges || [])];
    const details = await Promise.allSettled(open.map(c => getChallengeDetails(c._id)));
    const toApprove = details.flatMap((d, i) =>
        d.status === 'fulfilled' ? [{ challenge: open[i], count: (d.value.entrepreneurs || []).filter(e => !e.approved).length }] : [],
    ).filter(x => x.count > 0);
    return { closed: closed.challenges || [], active: active.challenges || [], toApprove };
}

/** All Impact Challenges, newest month first: create, open the votes, cancel, delete. */
export default function ImpactChallengePage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const canWrite = usePermission('impactChallenge') === 'write';
    const { values, set, clear, activeCount, page, setPage } = useUrlFilters(FILTER_KEYS);
    const filters = usePageFilters();
    const queueParams = countryOnly(filters.apiParams);
    const clearAll = () => clear(['pays', 'periode', 'du', 'au']);
    const statusFilter = values.status as ChallengeStatus | '';

    const [creating, setCreating] = useState(false);
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);

    const list = useQuery({
        queryKey: [...KEY, 'list', page, statusFilter, filters.apiParams],
        queryFn: () => fetchChallenges(page, PAGE_SIZE, statusFilter || undefined, filters.apiParams),
        placeholderData: prev => prev,
    });
    // Queues: everything pending whatever the period (country only).
    const work = useQuery({ queryKey: [...KEY, 'work', queueParams], queryFn: () => loadWork(queueParams) });

    const challenges = list.data?.challenges ?? [];
    const total = list.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: KEY }); };

    const open = (c: ImpactChallenge) => navigate(`/impact-challenges/${c._id}`);

    const ask = (kind: 'activate' | 'cancel' | 'delete', c: ImpactChallenge) => {
        const fail = (err: unknown) => { throw new Error(apiErrorMessage(err, 'L’action a échoué.')); };
        if (kind === 'activate') {
            setConfirm({
                title: 'Ouvrir les votes ?',
                tone: 'primary',
                confirmLabel: 'Ouvrir les votes',
                description: `« ${c.campaignName} » apparaît dans l’app : les membres paient pour voter, et chaque vote leur donne aussi des tickets de la tombola du mois.`,
                body: <p className="text-sm text-fg-muted">Il faut au moins un entrepreneur approuvé, et aucun autre challenge ne doit avoir ses votes ouverts.</p>,
                onConfirm: async () => {
                    await updateChallengeStatus(c._id, 'active').catch(fail);
                    toast.success(`Votes ouverts pour « ${c.campaignName} ».`);
                    refresh();
                },
            });
        } else if (kind === 'cancel') {
            setConfirm({
                title: 'Annuler ce challenge ?',
                confirmLabel: 'Annuler le challenge',
                description: `« ${c.campaignName} » s’arrête et ne pourra plus être rouvert. Rien n’a été collecté, donc personne n’est à rembourser.`,
                onConfirm: async () => {
                    await updateChallengeStatus(c._id, 'cancelled').catch(fail);
                    toast.success(`« ${c.campaignName} » est annulé.`);
                    refresh();
                },
            });
        } else {
            setConfirm({
                title: 'Supprimer ce challenge ?',
                confirmLabel: 'Supprimer',
                description: `« ${c.campaignName} » disparaît de la liste. C’est définitif. La tombola du mois reste.`,
                onConfirm: async () => {
                    await deleteChallenge(c._id).catch(fail);
                    toast.success(`« ${c.campaignName} » est supprimé.`);
                    refresh();
                },
            });
        }
    };

    const todo: TodoItem[] = useMemo(() => {
        const w = work.data;
        if (!w) return [];
        const items: TodoItem[] = [];
        const toPay = w.closed.filter(c => !c.distributionInProgress);
        const running = w.closed.filter(c => c.distributionInProgress);
        if (toPay.length) {
            items.push({
                key: 'pay',
                label: `${plural(toPay.length, 'Challenge')} aux votes clôturés : fonds à distribuer`,
                hint: toPay.map(c => c.campaignName).join(', '),
                count: toPay.length,
                action: toPay.length === 1
                    ? <TodoAction onClick={() => open(toPay[0])}>Distribuer</TodoAction>
                    : <TodoAction onClick={() => set({ status: 'voting_closed' })}>Voir</TodoAction>,
            });
        }
        if (running.length) {
            items.push({
                key: 'running', tone: 'info', count: running.length,
                label: 'Versement en cours',
                hint: 'S’il reste affiché longtemps, il a été interrompu côté serveur : prévenir l’équipe technique.',
                action: <TodoAction onClick={() => open(running[0])}>Ouvrir</TodoAction>,
            });
        }
        for (const t of w.toApprove) {
            items.push({
                key: `approve-${t.challenge._id}`,
                label: `${plural(t.count, 'Entrepreneur')} à approuver`,
                hint: `${t.challenge.campaignName} · ${STATUS_LABELS[t.challenge.status]}`,
                count: t.count,
                action: <TodoAction onClick={() => open(t.challenge)}>Approuver</TodoAction>,
            });
        }
        return items;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [work.data]);

    const current = work.data?.active[0];

    const actionsFor = (c: ImpactChallenge) => {
        const items = [
            canActivate(c) && <MenuItem key="a" onSelect={() => ask('activate', c)}><HugeiconsIcon icon={VoteIcon} size={16} aria-hidden="true" />Ouvrir les votes</MenuItem>,
            canCancel(c) && <MenuItem key="c" onSelect={() => ask('cancel', c)}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />Annuler le challenge</MenuItem>,
            canDelete(c) && <MenuItem key="d" destructive onSelect={() => ask('delete', c)}><HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />Supprimer</MenuItem>,
        ].filter(Boolean);
        return (
            <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => open(c)}>
                    Gérer<HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden="true" />
                </Button>
                {canWrite && (items.length > 0 ? <RowMenu>{items}</RowMenu> : <span className="hidden w-9 sm:block" aria-hidden="true" />)}
            </div>
        );
    };

    const statusCell = (c: ImpactChallenge) => (
        <div className="flex flex-col items-end gap-1 md:items-start">
            <StatusBadge status={c.status} />
            {c.status === 'voting_closed' && (
                <span className="text-xs text-fg-muted">{c.distributionInProgress ? 'Versement en cours' : 'Fonds à distribuer'}</span>
            )}
        </div>
    );

    const columns: ListColumn<ImpactChallenge>[] = [
        {
            key: 'name', header: 'Challenge', cell: c => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{c.campaignName}</p>
                    <p className="text-xs text-fg-muted">{monthLabel(c.month, c.year)} · votes du {formatDate(c.startDate)} au {formatDate(c.endDate)}</p>
                </div>
            ),
        },
        { key: 'status', header: 'Statut', cell: statusCell },
        { key: 'votes', header: 'Votes', numeric: true, cell: c => formatNumber(c.totalVoteCount ?? 0) },
        { key: 'collected', header: 'Collecté', numeric: true, cell: c => <Money value={c.totalCollected} /> },
        { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true, cell: actionsFor },
    ];

    const card = (c: ImpactChallenge) => (
        <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="font-medium text-fg">{c.campaignName}</p>
                    <p className="text-xs text-fg-muted">{monthLabel(c.month, c.year)} · {formatDate(c.startDate)} → {formatDate(c.endDate)}</p>
                </div>
                {statusCell(c)}
            </div>
            <div className="flex items-baseline justify-between text-sm">
                <span className="text-fg-muted">{formatNumber(c.totalVoteCount ?? 0)} {plural(c.totalVoteCount ?? 0, 'vote')}</span>
                <Money value={c.totalCollected} className="font-medium text-fg" />
            </div>
            {actionsFor(c)}
        </div>
    );

    return (
        <div className="space-y-6">
            <PageHeader
                title="Impact Challenge"
                description="Chaque mois, jusqu’à 3 entrepreneurs présentent leur projet en vidéo ; les membres paient pour voter. 50 % au gagnant, 30 % à la cagnotte de la tombola, 20 % à SBC."
                actions={(
                    <Can module="impactChallenge" write>
                        <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={() => setCreating(true)}>
                            <HugeiconsIcon icon={PlusSignIcon} size={18} aria-hidden="true" />
                            Nouveau challenge
                        </Button>
                    </Can>
                )}
            />

            <PageFilters filters={filters} onReset={clearAll}>
                <FilterSelect
                    className="sm:w-48"
                    label="Statut"
                    allLabel="Tous les statuts"
                    value={statusFilter}
                    onChange={v => set({ status: v })}
                    options={(Object.keys(STATUS_LABELS) as ChallengeStatus[]).map(st => ({ value: st, label: STATUS_LABELS[st] }))}
                />
                {activeCount > 0 && !filters.isFiltered && (
                    <Button variant="ghost" size="sm" className="self-start sm:self-auto" onClick={clearAll}>Effacer les filtres</Button>
                )}
            </PageFilters>

            {work.isError ? null : <TodoPanel items={todo} loading={work.isLoading} />}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Metric
                    label="Challenge en cours"
                    icon={Award01Icon}
                    tone="primary"
                    value={work.isLoading ? <Skeleton className="h-7 w-40" /> : current ? <span className="block truncate text-lg">{current.campaignName}</span> : <span className="text-lg text-fg-muted">Aucun</span>}
                    hint={current ? <>Fin des votes <DateText value={current.endDate} /></> : 'Aucun challenge n’a ses votes ouverts.'}
                    onClick={current ? () => open(current) : undefined}
                />
                <Metric
                    label="Collecté sur le challenge en cours"
                    value={work.isLoading ? <Skeleton className="h-7 w-28" /> : <Money value={current?.totalCollected ?? 0} />}
                    hint={current ? `${formatNumber(current.totalVoteCount ?? 0)} ${plural(current.totalVoteCount ?? 0, 'vote')}` : '—'}
                />
                <Metric
                    label="Fonds à distribuer"
                    tone={(work.data?.closed.length ?? 0) > 0 ? 'warning' : 'neutral'}
                    value={work.isLoading ? <Skeleton className="h-7 w-20" /> : <Money value={(work.data?.closed ?? []).reduce((s, c) => s + (c.totalCollected ?? 0), 0)} />}
                    hint={`${work.data?.closed.length ?? 0} ${plural(work.data?.closed.length ?? 0, 'challenge')} aux votes clôturés`}
                />
            </div>

            <Panel>
                <PanelHeader
                    title="Tous les challenges"
                    description={list.data ? `${formatNumber(total)} ${plural(total, 'challenge')}` : undefined}
                />
                <div className={list.isFetching && !list.isLoading ? 'opacity-60 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={challenges}
                        columns={columns}
                        card={card}
                        rowKey={c => c._id}
                        onRowClick={open}
                        loading={list.isLoading}
                        className="border-t border-line"
                        empty={list.isError ? (
                            <ErrorState error={new Error(apiErrorMessage(list.error, 'Impossible de charger les challenges.'))} onRetry={() => void list.refetch()} retrying={list.isFetching} />
                        ) : (
                            <EmptyState
                                icon={Award01Icon}
                                title={statusFilter || filters.isFiltered ? 'Aucun challenge avec ces filtres' : 'Aucun challenge pour l’instant'}
                                description={statusFilter || filters.isFiltered ? 'Changez de statut, de pays ou de période, ou effacez les filtres.' : 'Créez le challenge du mois avec « Nouveau challenge ».'}
                                action={statusFilter || filters.isFiltered ? <Button size="lg" onClick={clearAll}>Effacer les filtres</Button> : undefined}
                            />
                        )}
                    />
                </div>
                <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
            </Panel>

            {creating && (
                <ChallengeFormModal
                    onClose={() => setCreating(false)}
                    onSaved={saved => {
                        setCreating(false);
                        refresh();
                        // Shown by the challenge page, where the admin lands.
                        navigate(`/impact-challenges/${saved._id}`, {
                            state: { flash: `« ${saved.campaignName} » est créé en brouillon. Ajoute les entrepreneurs, approuve-les, puis ouvre les votes.` },
                        });
                    }}
                />
            )}

            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
