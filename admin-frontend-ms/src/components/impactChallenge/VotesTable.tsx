import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { RefreshIcon, VoteIcon } from '@hugeicons/core-free-icons';
import { ChallengeVote, apiErrorMessage } from '../../services/impactChallengeApi';
import { fetchVotes, type AdminFilterParams } from './api';
import { Badge, Button, EmptyState, Pagination, ResponsiveList, type ListColumn } from '../ui';
import { DateText, ErrorState, Money, plural } from '../moduleKit';

const PAGE_SIZE = 20;

/**
 * Paid votes (members, with tombola tickets) and supports (anyone, no
 * tickets), newest first. The service returns only the member's id, and there
 * is no batch member lookup: one request per row would eat the admin rate
 * limit (500 per 15 min per IP), so a member vote links to the member's page.
 */
const VotesTable: React.FC<{ challengeId: string; entrepreneurNames: Record<string, string>; reloadKey?: number; filterParams?: AdminFilterParams }> = ({
    challengeId,
    entrepreneurNames,
    reloadKey = 0,
    filterParams,
}) => {
    const [votes, setVotes] = useState<ChallengeVote[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchVotes(challengeId, page, PAGE_SIZE, filterParams ?? {});
            setVotes(res.votes || []);
            setTotal(res.total || 0);
        } catch (err) {
            setError(apiErrorMessage(err, 'Impossible de charger les votes.'));
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [challengeId, page, JSON.stringify(filterParams ?? {})]);

    const filterKey = JSON.stringify(filterParams ?? {});
    useEffect(() => { setPage(1); }, [filterKey]);
    useEffect(() => { load(); }, [load, reloadKey]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const who = (v: ChallengeVote) => {
        if (v.userId) {
            return <Link to={`/userpage/${v.userId}`} className="text-primary hover:underline" onClick={e => e.stopPropagation()}>Membre (voir la fiche)</Link>;
        }
        if (v.isAnonymous) return <span className="text-fg-muted">Anonyme</span>;
        return (
            <span>
                <span className="text-fg">{v.supporterName || 'Soutien'}</span>
                {(v.supporterPhone || v.supporterEmail) && (
                    <span className="block text-xs text-fg-muted">{[v.supporterPhone, v.supporterEmail].filter(Boolean).join(' · ')}</span>
                )}
            </span>
        );
    };

    const kind = (v: ChallengeVote) => {
        const tickets = v.tombolaTicketIds?.length ?? 0;
        return (
            <div className="flex flex-col items-start gap-1 sm:items-start">
                <Badge tone={v.voteType === 'vote' ? 'primary' : 'info'}>{v.voteType === 'vote' ? 'Vote membre' : 'Soutien'}</Badge>
                <span className="text-xs text-fg-muted">
                    {v.voteQuantity} {plural(v.voteQuantity, 'vote')}
                    {v.voteType === 'vote' && ` · ${tickets} ${plural(tickets, 'ticket')}`}
                </span>
                {v.lateAfterClose && <Badge tone="warning">Payé après la clôture : non compté</Badge>}
                {v.ticketGenerationError && <Badge tone="danger">Tickets non créés</Badge>}
            </div>
        );
    };

    const columns: ListColumn<ChallengeVote>[] = [
        {
            key: 'who', header: 'Par', cell: v => (
                <div>
                    {who(v)}
                    {v.supportMessage && <span className="mt-0.5 block text-xs italic text-fg-muted">« {v.supportMessage} »</span>}
                </div>
            ),
        },
        { key: 'for', header: 'Pour', cell: v => <span className="text-fg">{entrepreneurNames[v.entrepreneurId] ?? '—'}</span> },
        { key: 'type', header: 'Type', cell: kind },
        { key: 'amount', header: 'Montant', numeric: true, cell: v => <Money value={v.amountPaid} /> },
        { key: 'date', header: 'Date', cell: v => <DateText value={v.createdAt} className="text-fg-muted" /> },
    ];

    return (
        <div>
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <p className="text-sm text-fg-muted">
                    {loading ? 'Chargement…' : `${total.toLocaleString('fr-FR')} ${plural(total, 'paiement confirmé', 'paiements confirmés')}`}
                </p>
                <Button variant="ghost" size="md" className="h-11 sm:h-9" onClick={load}>
                    <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />Rafraîchir
                </Button>
            </div>
            <div className={loading && votes.length ? 'opacity-60' : undefined}>
                <ResponsiveList
                    rows={votes}
                    columns={columns}
                    rowKey={v => v._id}
                    loading={loading && votes.length === 0}
                    empty={error
                        ? <ErrorState error={new Error(error)} onRetry={load} />
                        : <EmptyState icon={VoteIcon} title="Aucun vote payé pour l’instant" description="Les votes apparaissent ici dès que le paiement est confirmé." />}
                />
            </div>
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
    );
};

export default VotesTable;
