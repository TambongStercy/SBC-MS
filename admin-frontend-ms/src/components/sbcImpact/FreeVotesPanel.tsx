import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckListIcon } from '@hugeicons/core-free-icons';
import { EmptyState, Pagination, Panel, PanelHeader, ResponsiveList, type ListColumn } from '../ui';
import { DateText, ErrorState, FilterSelect, formatNumber, plural } from '../moduleKit';
import { impactErrorMessage, listFreeVotes, type FreeVoteRow } from '../../services/impactV2Api';
import { candidateName, type CandidateIndex } from './candidateIndex';

const PAGE_SIZE = 50;

/** The week-2 free votes (1 account = 1 vote), newest first, with the voters' names. */
export default function FreeVotesPanel({ editionId, index }: { editionId: string; index?: CandidateIndex }) {
    const [candidateId, setCandidateId] = useState('');
    const [page, setPage] = useState(1);
    const list = useQuery({
        queryKey: ['sbc-impact', 'free-votes', editionId, { candidateId, page }],
        queryFn: () => listFreeVotes(editionId, { candidateId, page, limit: PAGE_SIZE }),
        placeholderData: prev => prev,
    });
    const rows = list.data?.items ?? [];
    const total = list.data?.total ?? 0;

    const columns: ListColumn<FreeVoteRow>[] = [
        { key: 'voter', header: 'Votant', cell: v => <span className="font-medium text-fg">{v.voterName ?? `…${v.voterUserId.slice(-6)}`}</span> },
        { key: 'candidate', header: 'Pour', cell: v => v.candidateName ?? candidateName(index, v.candidateId) },
        { key: 'at', header: 'Date', cell: v => <DateText value={v.at} /> },
    ];

    return (
        <Panel>
            <PanelHeader
                title="Vote gratuit"
                description={list.data ? `${formatNumber(total)} ${plural(total, 'vote')}${candidateId ? ' pour ce candidat' : ''}` : '1 compte SBC = 1 vote.'}
                actions={(
                    <FilterSelect className="w-56" label="Candidat" allLabel="Tous les candidats" value={candidateId}
                        onChange={v => { setCandidateId(v); setPage(1); }}
                        options={[...(index?.values() ?? [])].map(c => ({ value: c._id, label: candidateName(index, c._id) }))} />
                )}
            />
            <div className={list.isFetching && !list.isLoading ? 'opacity-60 transition-opacity' : undefined}>
                <ResponsiveList
                    rows={rows}
                    columns={columns}
                    rowKey={v => v._id}
                    loading={list.isLoading}
                    className="border-t border-line"
                    empty={list.isError ? (
                        <ErrorState error={new Error(impactErrorMessage(list.error, 'Impossible de charger les votes gratuits.'))} onRetry={() => void list.refetch()} retrying={list.isFetching} />
                    ) : (
                        <EmptyState icon={CheckListIcon} title="Aucun vote gratuit pour l’instant" />
                    )}
                />
            </div>
            <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </Panel>
    );
}
