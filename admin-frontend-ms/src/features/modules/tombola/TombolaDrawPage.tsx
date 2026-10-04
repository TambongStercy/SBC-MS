import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import { Trophy } from 'lucide-react';
import { MemberById } from '../../members/MemberById';
import { Button, Card, ConfirmSheet, DataList, EmptyState, ErrorState, KeyValue, MemberLink, Page, Pagination, SearchInput, SectionTitle, Skeleton, StatusBadge, notify, type Column } from '../../../ui';
import { formatDate, formatDateTime, formatNumber } from '../../../lib/format';
import { useDebounced } from '../../../lib/hooks';
import { STATUS, drawTombola, getTicketNumbers, getTombola, listTickets, periodLabel, rankLabel, setTombolaStatus, type Ticket, type TombolaMonth, type Winner } from './api';

const PAGE = 20;

/**
 * The reveal after a draw: the server has already picked the winners; this rolls
 * through the month's real ticket numbers and lands on each winning one in turn,
 * third prize first, for whoever is filming the draw.
 */
function Reveal({ winners, numbers, onDone }: { winners: Winner[]; numbers: number[]; onDone: () => void }) {
    const order = [...winners].sort((a, b) => b.rank - a.rank);
    const [step, setStep] = useState(0);
    const [rolling, setRolling] = useState<number | null>(null);
    const timer = useRef<number>();

    useEffect(() => {
        if (step >= order.length) return;
        const pool = numbers.length ? numbers : order.map(w => w.winningTicketNumber);
        let ticks = 0;
        timer.current = window.setInterval(() => {
            ticks += 1;
            setRolling(pool[Math.floor(Math.random() * pool.length)]);
            if (ticks > 26) {
                window.clearInterval(timer.current);
                setRolling(order[step].winningTicketNumber);
                confetti({ particleCount: order[step].rank === 1 ? 180 : 80, spread: 75, origin: { y: 0.6 } });
                window.setTimeout(() => setStep(s => s + 1), 1600);
            }
        }, 70);
        return () => window.clearInterval(timer.current);
    }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

    const current = order[Math.min(step, order.length - 1)];
    const finished = step >= order.length;
    return (
        <Card className="text-center space-y-4 py-8">
            {!finished && current && (
                <>
                    <p className="text-sm font-semibold text-ink-2 uppercase tracking-wider">{rankLabel(current.rank)} · {current.prize}</p>
                    <p className="text-6xl font-extrabold tabular text-primary">#{rolling ?? '—'}</p>
                </>
            )}
            <ul className="space-y-2 max-w-sm mx-auto text-left">
                {order.slice(0, step).reverse().map(w => (
                    <li key={w.rank} className="flex items-center gap-3 rounded-tile border border-border px-3 py-2">
                        <Trophy size={18} className={w.rank === 1 ? 'text-warning' : 'text-ink-3'} />
                        <span className="flex-1 min-w-0"><MemberById id={w.userId} /></span>
                        <span className="text-sm font-semibold tabular">#{w.winningTicketNumber}</span>
                    </li>
                ))}
            </ul>
            {finished && <Button onClick={onDone}>Terminer</Button>}
        </Card>
    );
}

function Winners({ t }: { t: TombolaMonth }) {
    if (!t.winners.length) return null;
    return (
        <section>
            <SectionTitle>Gagnants</SectionTitle>
            <ul className="divide-y divide-border border border-border rounded-card bg-surface">
                {[...t.winners].sort((a, b) => a.rank - b.rank).map(w => (
                    <li key={w.rank} className="flex items-center gap-3 px-4 py-3">
                        <Trophy size={20} className={w.rank === 1 ? 'text-warning' : 'text-ink-3'} />
                        <div className="min-w-0 flex-1"><MemberById id={w.userId} /></div>
                        <div className="text-right shrink-0"><p className="text-sm font-semibold">{rankLabel(w.rank)} · {w.prize}</p><p className="text-xs text-ink-2 tabular">Billet #{w.winningTicketNumber}</p></div>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function Tickets({ id }: { id: string }) {
    const [search, setSearch] = useState('');
    const term = useDebounced(search.trim());
    const [page, setPage] = useState(1);
    useEffect(() => setPage(1), [term]);
    const q = useQuery({ queryKey: ['tombola', 'tickets', id, term, page], queryFn: () => listTickets(id, page, PAGE, term || undefined), placeholderData: keepPreviousData });
    const cols: Column<Ticket>[] = [
        { key: 'n', header: 'Billet', cell: t => <span className="font-semibold tabular">#{t.ticketNumber}</span> },
        { key: 'm', header: 'Membre', cell: t => <MemberLink id={t.userId} name={t.userName} phone={t.userPhoneNumber} /> },
        { key: 'd', header: 'Acheté', cell: t => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(t.purchaseTimestamp)}</span> },
    ];
    return (
        <section className="space-y-3">
            <SectionTitle>Billets</SectionTitle>
            <SearchInput value={search} onChange={setSearch} placeholder="Nom, téléphone ou e-mail du membre" />
            <DataList rows={q.data?.data} columns={cols} rowKey={t => t._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                empty={<EmptyState title={term ? 'Aucun billet pour ce membre' : 'Aucun billet vendu'} />}
                card={t => (
                    <span className="flex items-center gap-3">
                        <span className="font-semibold tabular w-14 shrink-0">#{t.ticketNumber}</span>
                        <span className="min-w-0 flex-1"><MemberLink id={t.userId} name={t.userName} phone={t.userPhoneNumber} /></span>
                    </span>
                )} />
            {q.data && q.data.pagination.totalCount > PAGE && <Pagination page={page} totalPages={q.data.pagination.totalPages} total={q.data.pagination.totalCount} onChange={setPage} />}
        </section>
    );
}

/** One month's tombola: its tickets, the draw, the winners. */
export default function TombolaDrawPage() {
    const id = useParams().monthId!;
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ['tombola', 'one', id], queryFn: () => getTombola(id) });
    const sold = useQuery({ queryKey: ['tombola', 'tickets', id, '', 1], queryFn: () => listTickets(id, 1, PAGE) });
    const [action, setAction] = useState<'draw' | 'close' | 'reopen' | null>(null);
    const [reveal, setReveal] = useState<{ winners: Winner[]; numbers: number[] } | null>(null);

    if (q.isError) return <Page title="Tombola" back="/modules/tombola"><ErrorState onRetry={() => q.refetch()} /></Page>;
    const t = q.data;
    if (!t) return <Page title="Tombola" back="/modules/tombola"><Skeleton className="h-64" /></Page>;
    const count = sold.data?.pagination.totalCount ?? t.lastTicketNumber;
    const drawn = t.winners.length > 0;
    const canDraw = (t.status === 'open' || t.status === 'drawing') && !drawn;
    const refresh = () => qc.invalidateQueries({ queryKey: ['tombola'] });

    return (
        <Page title={`Tombola de ${periodLabel(t).toLowerCase()}`} back="/modules/tombola" width="narrow">
            <div className="space-y-5">
                {reveal ? <Reveal winners={reveal.winners} numbers={reveal.numbers} onDone={() => setReveal(null)} /> : (
                    <Card className="space-y-4">
                        <StatusBadge status={t.status} labels={STATUS} />
                        <KeyValue items={[
                            ['Billets vendus', formatNumber(count)],
                            ['Ouverte le', formatDate(t.startDate)],
                            t.drawDate ? ['Tirage', formatDateTime(t.drawDate)] : null,
                            t.status === 'closed' && !drawn && t.drawDate ? ['Résultat', 'Fermée sans gagnant (aucun billet éligible)'] : null,
                        ]} />
                        {canDraw && (
                            <div className="grid grid-cols-2 gap-2">
                                <Button variant="secondary" onClick={() => setAction('close')}>Fermer…</Button>
                                <Button onClick={() => setAction('draw')}>Tirer au sort…</Button>
                            </div>
                        )}
                        {t.status === 'closed' && !drawn && <Button variant="secondary" full onClick={() => setAction('reopen')}>Rouvrir…</Button>}
                    </Card>
                )}
                {!reveal && <Winners t={t} />}
                <Tickets id={id} />
            </div>

            <ConfirmSheet open={action === 'draw'} onClose={() => setAction(null)} title={`Tirer au sort ${periodLabel(t).toLowerCase()} ?`}
                message={<>
                    <p>Jusqu’à 3 gagnants tirés parmi {formatNumber(count)} billets, un seul prix par personne.
                        {t.previousMonthWinners?.length ? ` Les ${t.previousMonthWinners.length} gagnants du mois précédent sont exclus.` : ''}</p>
                    <p>La tombola se ferme et les gagnants reçoivent une notification. C’est définitif.</p>
                </>}
                confirmLabel="Tirer au sort"
                onConfirm={async () => {
                    const [after, numbers] = await Promise.all([drawTombola(id), getTicketNumbers(id).catch(() => [] as number[])]);
                    if (after.winners.length) setReveal({ winners: after.winners, numbers });
                    else notify.info('Aucun billet éligible : la tombola est fermée sans gagnant.');
                    refresh();
                }} />
            <ConfirmSheet open={action === 'close'} onClose={() => setAction(null)} tone="danger" title="Fermer les ventes ?"
                message={<p>Plus personne ne peut acheter de billet. Pour faire le tirage ensuite, il faudra la rouvrir : le tirage n’est possible que sur une tombola ouverte.</p>}
                confirmLabel="Fermer"
                onConfirm={async () => { await setTombolaStatus(id, 'closed'); notify.success('Ventes fermées.'); refresh(); }} />
            <ConfirmSheet open={action === 'reopen'} onClose={() => setAction(null)} tone="success" title="Rouvrir cette tombola ?"
                message={<p>Les membres peuvent de nouveau acheter des billets. Toute autre tombola ouverte se ferme.</p>}
                confirmLabel="Rouvrir"
                onConfirm={async () => { await setTombolaStatus(id, 'open'); notify.success('Tombola rouverte.'); refresh(); }} />
        </Page>
    );
}
