import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Award01Icon, PlusSignIcon, Ticket01Icon, UserMultipleIcon } from '@hugeicons/core-free-icons';
import { Can } from '../components/Can';
import { Button, EmptyState, Metric, PageHeader, Panel, PanelHeader, ResponsiveList, Skeleton, type ListColumn } from '../components/ui';
import {
    DateText, ErrorState, FilterSelect, TodoAction, TodoPanel, formatDateTime, formatNumber, plural, useUrlFilters, type TodoItem,
} from '../components/moduleKit';
import NewEditionSheet from '../components/sbcImpact/NewEditionSheet';
import { EditionStatusBadge } from '../components/sbcImpact/shared';
import {
    EDITION_STATUS_LABELS, impactErrorMessage, listEditions, type Edition, type EditionStatus,
} from '../services/impactV2Api';

const KEY = ['sbc-impact'] as const;
const FILTER_KEYS = ['statut'] as const;
/** Editions members see as "the current Challenge" (one at a time). */
const LIVE: EditionStatus[] = ['QUALIFICATION', 'QUALIFICATION_CLOSED', 'COMPETITION', 'FINAL'];

/** "12 / 20" (each list item carries its seats taken). */
const seats = (e: Edition) => `${formatNumber(e.seatsTaken ?? 0)} / ${formatNumber(e.settings?.maxCandidates)}`;

/** SBC Impact Challenge v2: the editions, newest first, and « Nouvelle édition ». */
export default function SbcImpactEditionsPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { values, set, clear, activeCount } = useUrlFilters(FILTER_KEYS);
    const statusFilter = values.statut as EditionStatus | '';
    const [creating, setCreating] = useState(false);

    const list = useQuery({ queryKey: [...KEY, 'editions'], queryFn: listEditions });
    const editions = useMemo(() => list.data ?? [], [list.data]);
    const live = editions.find(e => LIVE.includes(e.status));

    const rows = statusFilter ? editions.filter(e => e.status === statusFilter) : editions;
    const open = (e: Edition) => navigate(`/sbc-impact/${e._id}`);

    // Profiles to review and seats below the requirement are on each edition's page.
    const todo: TodoItem[] = [];
    const drafts = editions.filter(e => e.status === 'DRAFT');
    if (drafts.length) {
        todo.push({
            key: 'drafts', tone: 'info',
            label: `${plural(drafts.length, 'Édition')} en préparation`,
            hint: drafts.map(d => d.name).join(', '),
            count: drafts.length,
            action: <TodoAction onClick={() => open(drafts[0])}>Ouvrir</TodoAction>,
        });
    }

    const qualification = (e: Edition) => (
        <span className="text-sm text-fg-muted">
            {formatDateTime(e.schedule.qualificationOpensAt)} → {formatDateTime(e.schedule.qualificationClosesAt)}
        </span>
    );

    const columns: ListColumn<Edition>[] = [
        {
            key: 'name', header: 'Édition', cell: e => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{e.name}</p>
                    {e.description && <p className="line-clamp-1 text-xs text-fg-muted">{e.description}</p>}
                </div>
            ),
        },
        { key: 'status', header: 'Statut', cell: e => <EditionStatusBadge status={e.status} /> },
        { key: 'qualification', header: 'Qualification', cell: qualification },
        {
            key: 'seats', header: 'Places prises', numeric: true, cell: seats,
        },
        {
            key: 'go', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true, cell: e => (
                <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={ev => { ev.stopPropagation(); open(e); }}>
                    Gérer<HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden="true" />
                </Button>
            ),
        },
    ];

    const card = (e: Edition) => (
        <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-medium text-fg">{e.name}</p>
                <EditionStatusBadge status={e.status} />
            </div>
            <p className="text-xs text-fg-muted">Qualification : {formatDateTime(e.schedule.qualificationOpensAt)} → {formatDateTime(e.schedule.qualificationClosesAt)}</p>
            <p className="text-xs text-fg-muted">{seats(e)} places prises</p>
        </div>
    );

    return (
        <div className="space-y-6">
            <PageHeader
                title="SBC Impact Challenge"
                description="Chaque édition : une qualification (10 invitations de filleuls qui paient leur pack donnent une place), puis la compétition, la finale et la tombola."
                actions={(
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                        <Link to="/sbc-impact/tombola"><HugeiconsIcon icon={Ticket01Icon} size={18} aria-hidden="true" />Historique de la tombola</Link>
                    </Button>
                    <Can module="impactChallenge" write>
                        <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={() => setCreating(true)}>
                            <HugeiconsIcon icon={PlusSignIcon} size={18} aria-hidden="true" />
                            Nouvelle édition
                        </Button>
                    </Can>
                    </div>
                )}
            />

            {!list.isError && <TodoPanel items={todo} loading={list.isLoading} />}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Metric
                    label="Édition en cours"
                    icon={Award01Icon}
                    tone="primary"
                    value={list.isLoading ? <Skeleton className="h-7 w-40" /> : live ? <span className="block truncate text-lg">{live.name}</span> : <span className="text-lg text-fg-muted">Aucune</span>}
                    hint={live ? <EditionStatusBadge status={live.status} /> : 'Aucune édition n’est ouverte aux membres.'}
                    onClick={live ? () => open(live) : undefined}
                />
                <Metric
                    label="Places prises"
                    icon={UserMultipleIcon}
                    value={list.isLoading ? <Skeleton className="h-7 w-20" /> : live ? seats(live) : '—'}
                    hint={live ? `${formatNumber(live.settings.invitationsRequired)} invitations pour une place` : undefined}
                />
                <Metric
                    label="Fin de la qualification"
                    value={live ? <span className="text-lg">{formatDateTime(live.schedule.qualificationClosesAt)}</span> : '—'}
                    hint={live ? <DateText value={live.schedule.qualificationClosesAt} /> : undefined}
                />
            </div>

            <Panel>
                <PanelHeader
                    title="Toutes les éditions"
                    description={list.data ? `${formatNumber(editions.length)} ${plural(editions.length, 'édition')}` : undefined}
                    actions={(
                        <div className="flex items-center gap-2">
                            <FilterSelect
                                className="w-48"
                                label="Statut"
                                allLabel="Tous les statuts"
                                value={statusFilter}
                                onChange={v => set({ statut: v })}
                                options={(Object.keys(EDITION_STATUS_LABELS) as EditionStatus[]).map(s => ({ value: s, label: EDITION_STATUS_LABELS[s] }))}
                            />
                        </div>
                    )}
                />
                <div className={list.isFetching && !list.isLoading ? 'opacity-60 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={rows}
                        columns={columns}
                        card={card}
                        rowKey={e => e._id}
                        onRowClick={open}
                        loading={list.isLoading}
                        className="border-t border-line"
                        empty={list.isError ? (
                            <ErrorState error={new Error(impactErrorMessage(list.error, 'Impossible de charger les éditions.'))} onRetry={() => void list.refetch()} retrying={list.isFetching} />
                        ) : (
                            <EmptyState
                                icon={Award01Icon}
                                title={activeCount ? 'Aucune édition avec ce statut' : 'Aucune édition pour l’instant'}
                                description={activeCount ? 'Changez de statut ou effacez le filtre.' : 'Créez la première avec « Nouvelle édition ».'}
                                action={activeCount ? <Button size="lg" onClick={clear}>Effacer le filtre</Button> : undefined}
                            />
                        )}
                    />
                </div>
            </Panel>

            {creating && (
                <NewEditionSheet
                    onClose={() => setCreating(false)}
                    onCreated={created => {
                        setCreating(false);
                        void queryClient.invalidateQueries({ queryKey: KEY });
                        navigate(`/sbc-impact/${created._id}?tab=regles`, {
                            state: { flash: `« ${created.name} » est créée en préparation. Rédigez le règlement, vérifiez les paramètres, puis ouvrez la qualification.` },
                        });
                    }}
                />
            )}
        </div>
    );
}
