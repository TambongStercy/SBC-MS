import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Pagination from '../common/Pagination';
import { ChallengeVote, apiErrorMessage, formatDateTime, formatXaf, listVotes } from '../../services/impactChallengeApi';
import { btn } from './styles';

const PAGE_SIZE = 20;

/**
 * Paid votes (members, with tombola tickets) and supports (anyone, no
 * tickets), newest first. The service returns only the member's id, and there
 * is no batch member lookup: one request per row would eat the admin rate
 * limit (500 per 15 min per IP), so a member vote links to the member's page.
 */
const VotesTable: React.FC<{ challengeId: string; entrepreneurNames: Record<string, string>; reloadKey?: number }> = ({
    challengeId,
    entrepreneurNames,
    reloadKey = 0,
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
            const res = await listVotes(challengeId, page, PAGE_SIZE);
            setVotes(res.votes || []);
            setTotal(res.total || 0);
        } catch (err) {
            setError(apiErrorMessage(err, 'Impossible de charger les votes.'));
        } finally {
            setLoading(false);
        }
    }, [challengeId, page]);

    useEffect(() => { load(); }, [load, reloadKey]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const who = (v: ChallengeVote) => {
        if (v.userId) {
            return (
                <Link to={`/userpage/${v.userId}`} className="text-blue-300 hover:text-blue-200">
                    Membre (voir la fiche)
                </Link>
            );
        }
        if (v.isAnonymous) return <span className="text-gray-300">Anonyme</span>;
        return (
            <span>
                <span className="text-gray-200">{v.supporterName || 'Soutien'}</span>
                {(v.supporterPhone || v.supporterEmail) && (
                    <span className="block text-xs text-gray-400">{[v.supporterPhone, v.supporterEmail].filter(Boolean).join(' · ')}</span>
                )}
            </span>
        );
    };

    return (
        <div>
            <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-sm text-gray-400">
                    {loading ? 'Chargement…' : `${total.toLocaleString('fr-FR')} paiement${total === 1 ? '' : 's'} confirmé${total === 1 ? '' : 's'}`}
                </p>
                <button onClick={load} className={btn.smallSecondary}><RefreshCw className="w-3.5 h-3.5" /> Rafraîchir</button>
            </div>
            {error && <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-200 text-sm mb-3">{error}</div>}
            {!loading && votes.length === 0 && !error ? (
                <p className="p-8 text-center text-gray-400">Aucun vote payé pour l’instant.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-900/50 text-gray-300">
                            <tr>
                                <th className="px-4 py-3 text-left">Date</th>
                                <th className="px-4 py-3 text-left">Par</th>
                                <th className="px-4 py-3 text-left">Pour</th>
                                <th className="px-4 py-3 text-left">Type</th>
                                <th className="px-4 py-3 text-right">Montant</th>
                            </tr>
                        </thead>
                        <tbody className={loading ? 'opacity-50' : ''}>
                            {votes.map(v => (
                                <tr key={v._id} className="border-t border-gray-700 align-top">
                                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{formatDateTime(v.createdAt)}</td>
                                    <td className="px-4 py-3">
                                        {who(v)}
                                        {v.supportMessage && <span className="block text-xs text-gray-400 italic mt-0.5">« {v.supportMessage} »</span>}
                                    </td>
                                    <td className="px-4 py-3 text-gray-200">{entrepreneurNames[v.entrepreneurId] ?? '—'}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${v.voteType === 'vote' ? 'bg-blue-900/60 text-blue-300' : 'bg-purple-900/60 text-purple-300'}`}>
                                            {v.voteType === 'vote' ? 'Vote membre' : 'Soutien'}
                                        </span>
                                        <span className="block text-xs text-gray-400 mt-1">
                                            {v.voteQuantity} vote{v.voteQuantity > 1 ? 's' : ''}
                                            {v.voteType === 'vote' && ` · ${v.tombolaTicketIds?.length ?? 0} ticket${(v.tombolaTicketIds?.length ?? 0) > 1 ? 's' : ''}`}
                                        </span>
                                        {v.lateAfterClose && (
                                            <span className="block text-xs text-amber-300 mt-1">Payé après la clôture : non compté</span>
                                        )}
                                        {v.ticketGenerationError && (
                                            <span className="block text-xs text-red-300 mt-1">Tickets non créés</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right text-white font-mono whitespace-nowrap">{formatXaf(v.amountPaid)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />}
        </div>
    );
};

export default VotesTable;
