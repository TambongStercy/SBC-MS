import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Download01Icon, UserMultipleIcon } from '@hugeicons/core-free-icons';
import { Button, EmptyState, Pagination, Panel, PanelHeader, ResponsiveList, type ListColumn } from '../ui';
import { ErrorState, FilterBar, FilterSelect, SearchInput, formatNumber, plural, useUrlFilters } from '../moduleKit';
import {
    CANDIDATE_STATUS_LABELS, REVIEW_LABELS, downloadCandidatesCsv, impactErrorMessage, listCandidates,
    type CandidateRow, type CandidateStatus, type Edition, type ReviewStatus,
} from '../../services/impactV2Api';
import { BelowRequirementBadge, CandidateStatusBadge, CandidateThumb, ReviewBadge } from './shared';
import { CANDIDATE_FILTER_KEYS } from './status';

const PAGE_SIZE = 20;

/** Statuses an edition's candidates can hold, up to the final's winner. */
const STATUS_OPTIONS: CandidateStatus[] = [
    'QUALIFYING', 'WAITLIST', 'OFFICIAL', 'STAGE_2', 'STAGE_3', 'FINALIST', 'WINNER', 'ELIMINATED', 'NOT_SELECTED', 'SUSPENDED', 'DISQUALIFIED', 'WITHDRAWN',
];

/** Free and paid votes (competition), and the TOP 3 rank once decided. */
function Votes({ c }: { c: CandidateRow }) {
    return (
        <span className="inline-flex flex-col items-end leading-tight md:items-start">
            <span className="tabular-nums text-fg">{formatNumber(c.votes?.paid ?? 0)} <span className="text-xs text-fg-muted">payants</span></span>
            <span className="text-xs tabular-nums text-fg-muted">{formatNumber(c.votes?.free ?? 0)} gratuits</span>
        </span>
    );
}

const rankText = (rank?: number | null) => (rank ? (rank === 1 ? '1er' : `${rank}e`) : '—');

/** Seat n°, or rank on the waiting list. */
function Place({ c }: { c: CandidateRow }) {
    if (c.seatNumber) return <span className="font-medium tabular-nums text-fg">n° {c.seatNumber}</span>;
    if (c.waitlistRank) return <span className="tabular-nums text-fg-muted">Attente {c.waitlistRank}</span>;
    return <span className="text-fg-subtle">—</span>;
}

function Invitations({ c }: { c: CandidateRow }) {
    const { valid, required, pending } = c.invitations;
    return (
        <span className="inline-flex flex-col items-end leading-tight md:items-start">
            <span className={valid >= required ? 'font-medium tabular-nums text-success' : 'tabular-nums text-fg'}>{formatNumber(valid)} / {formatNumber(required)}</span>
            {pending > 0 && <span className="text-xs text-fg-muted">+{formatNumber(pending)} en attente</span>}
        </span>
    );
}

function StatusCell({ c }: { c: CandidateRow }) {
    return (
        <div className="flex flex-wrap items-center justify-end gap-1 md:justify-start">
            <CandidateStatusBadge status={c.status} />
            {c.belowRequirement && <BelowRequirementBadge />}
        </div>
    );
}

/** The edition's candidates: seats first, then the waiting list, then by progress (server order). */
export default function CandidatesTab({ edition, onOpen }: { edition: Edition; onOpen: (candidateId: string) => void }) {
    const { values, set, clear, activeCount, page, setPage } = useUrlFilters(CANDIDATE_FILTER_KEYS);
    const status = values.statut as CandidateStatus | '';
    const review = values.avis as ReviewStatus | '';
    const below = values.sous === '1';

    const list = useQuery({
        queryKey: ['sbc-impact', 'candidates', edition._id, { status, review, below, q: values.q, page }],
        queryFn: () => listCandidates(edition._id, { status, review, below, q: values.q, page, limit: PAGE_SIZE }),
        placeholderData: prev => prev,
    });
    const rows = list.data?.items ?? [];
    const total = list.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const competition = !!edition.stage;
    const [exporting, setExporting] = useState(false);
    const exportCsv = async () => {
        setExporting(true);
        try {
            await downloadCandidatesCsv(edition._id);
        } catch (err) {
            toast.error(impactErrorMessage(err, 'L’export n’a pas pu être téléchargé.'));
        } finally {
            setExporting(false);
        }
    };

    const columns: ListColumn<CandidateRow>[] = [
        {
            key: 'who', header: 'Candidat', cell: c => (
                <div className="flex min-w-0 items-center gap-3">
                    <CandidateThumb fileId={c.profile.photoFileId} name={c.profile.name} />
                    <div className="min-w-0">
                        <p className="truncate font-medium text-fg">{c.profile.name}</p>
                        <p className="truncate text-xs text-fg-muted">{c.profile.projectName}</p>
                    </div>
                </div>
            ),
        },
        { key: 'place', header: 'Place', cell: c => <Place c={c} /> },
        ...(competition
            ? [
                { key: 'votes', header: 'Votes', cell: (c: CandidateRow) => <Votes c={c} /> },
                { key: 'rank', header: 'Rang', cell: (c: CandidateRow) => <span className="tabular-nums">{rankText(c.rank)}</span> },
            ]
            : [{ key: 'invitations', header: 'Invitations', cell: (c: CandidateRow) => <Invitations c={c} /> }]),
        { key: 'status', header: 'Statut', cell: c => <StatusCell c={c} /> },
        { key: 'review', header: 'Profil', cell: c => <ReviewBadge status={c.review.status} /> },
    ];

    const card = (c: CandidateRow) => (
        <div className="flex items-start gap-3">
            <CandidateThumb fileId={c.profile.photoFileId} name={c.profile.name} />
            <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="truncate font-medium text-fg">{c.profile.name}</p>
                        <p className="truncate text-xs text-fg-muted">{c.profile.projectName}</p>
                    </div>
                    <Place c={c} />
                </div>
                <div className="flex flex-wrap items-center gap-1">
                    <CandidateStatusBadge status={c.status} />
                    <ReviewBadge status={c.review.status} />
                    {c.belowRequirement && <BelowRequirementBadge />}
                </div>
                {competition ? (
                    <p className="text-xs text-fg-muted">
                        Votes : {formatNumber(c.votes?.paid ?? 0)} payants · {formatNumber(c.votes?.free ?? 0)} gratuits{c.rank ? ` · ${rankText(c.rank)}` : ''}
                    </p>
                ) : (
                    <p className="text-xs text-fg-muted">
                        Invitations : {formatNumber(c.invitations.valid)} / {formatNumber(c.invitations.required)}
                        {c.invitations.pending > 0 ? ` (+${formatNumber(c.invitations.pending)} en attente)` : ''}
                    </p>
                )}
            </div>
        </div>
    );

    return (
        <Panel>
            <PanelHeader
                title="Candidats"
                description={list.data ? `${formatNumber(total)} ${plural(total, 'candidat')}${activeCount ? ' avec ces filtres' : ''}` : undefined}
                actions={(
                    <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => void exportCsv()} loading={exporting}
                        title="Les candidats officiels, pour les visuels et les publications">
                        <HugeiconsIcon icon={Download01Icon} size={14} aria-hidden="true" />
                        <span className="hidden sm:inline">Exporter les candidats (CSV)</span><span className="sm:hidden">CSV</span>
                    </Button>
                )}
            />
            <div className="px-4 pb-3 sm:px-5">
                <FilterBar
                    search={<SearchInput value={values.q} onChange={v => set({ q: v })} placeholder="Nom, projet ou identifiant SBC" />}
                    filterCount={3}
                    activeCount={activeCount}
                    onClear={clear}
                    filters={(
                        <>
                            <FilterSelect
                                label="Statut"
                                allLabel="Tous les statuts"
                                value={status}
                                onChange={v => set({ statut: v })}
                                options={STATUS_OPTIONS.map(s => ({ value: s, label: CANDIDATE_STATUS_LABELS[s] }))}
                            />
                            <FilterSelect
                                label="Profil"
                                allLabel="Tous les profils"
                                value={review}
                                onChange={v => set({ avis: v })}
                                options={(Object.keys(REVIEW_LABELS) as ReviewStatus[]).map(r => ({ value: r, label: REVIEW_LABELS[r] }))}
                            />
                            <FilterSelect
                                label="Invitations"
                                allLabel="Toutes les invitations"
                                value={below ? '1' : ''}
                                onChange={v => set({ sous: v })}
                                options={[{ value: '1', label: `Sous le seuil${list.data?.belowRequirementCount ? ` (${formatNumber(list.data.belowRequirementCount)})` : ''}` }]}
                            />
                        </>
                    )}
                />
            </div>
            <div className={list.isFetching && !list.isLoading ? 'opacity-60 transition-opacity' : undefined}>
                <ResponsiveList
                    rows={rows}
                    columns={columns}
                    card={card}
                    rowKey={c => c._id}
                    onRowClick={c => onOpen(c._id)}
                    loading={list.isLoading}
                    className="border-t border-line"
                    empty={list.isError ? (
                        <ErrorState error={new Error(impactErrorMessage(list.error, 'Impossible de charger les candidats.'))} onRetry={() => void list.refetch()} retrying={list.isFetching} />
                    ) : (
                        <EmptyState
                            icon={UserMultipleIcon}
                            title={activeCount ? 'Aucun candidat avec ces filtres' : 'Aucun candidat pour l’instant'}
                            description={activeCount
                                ? 'Changez les filtres ou effacez-les.'
                                : edition.status === 'DRAFT'
                                    ? 'Les membres pourront déposer leur profil dès l’ouverture de la qualification.'
                                    : undefined}
                            action={activeCount ? <Button size="lg" onClick={clear}>Effacer les filtres</Button> : undefined}
                        />
                    )}
                />
            </div>
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </Panel>
    );
}
