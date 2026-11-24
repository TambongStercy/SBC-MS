import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { LinkSquare02Icon, Ticket01Icon } from '@hugeicons/core-free-icons';
import { Badge, Button, Metric, Panel, PanelBody, PanelHeader, Skeleton } from '../ui';
import { ConfirmDialog, ErrorState, Notice, formatDateTime, formatNumber, plural, type ConfirmOptions } from '../moduleKit';
import {
    commitTombola, drawTombola, getTombola, getTombolaProof, impactErrorMessage, revealNextWinner, tombolaProofUrl, tombolaScreenUrl,
    type Edition, type TicketTier, type TombolaDraw, type TombolaOverview,
} from '../../services/impactV2Api';
import TombolaWinners from './TombolaWinners';

/** "1 du 1er au 10e ticket · 0,5 jusqu’au 50e · 0,25 au-delà" */
function tiersText(tiers: TicketTier[]) {
    let from = 1;
    return tiers.map(t => {
        const w = formatNumber(t.weight, 2);
        const part = t.upTo == null ? `${w} au-delà` : `${w} du ${from === 1 ? '1er' : `${from}e`} au ${t.upTo}e ticket`;
        from = (t.upTo ?? from) + 1;
        return part;
    }).join(' · ');
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
    return (
        <section className="space-y-3 rounded-panel border border-line p-4" aria-label={`Étape ${n} : ${title}`}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${done ? 'bg-success-soft text-success' : 'bg-surface-3 text-fg-muted'}`}>{n}</span>
                {title}
            </h3>
            {children}
        </section>
    );
}

/**
 * The SBC Tombola of an edition (spec §13): the tickets and the chances, then
 * the commit–reveal draw: 1. fix the seed (its fingerprint is public), 2. run
 * the draw (admin code), 3. reveal the winners one by one on the live screen.
 */
export default function TombolaTab({ edition, canWrite, onChanged }: { edition: Edition; canWrite: boolean; onChanged: () => void }) {
    const queryClient = useQueryClient();
    const key = ['sbc-impact', 'tombola', edition._id];
    const q = useQuery({ queryKey: key, queryFn: () => getTombola(edition._id) });
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
    const [seed, setSeed] = useState<string | null>(null);
    const [revealing, setRevealing] = useState(false);
    const draw = q.data?.draw ?? null;
    // The admin overview does not carry the revealed seed: the public proof does.
    const proof = useQuery({
        queryKey: ['sbc-impact', 'tombola-proof', draw?._id],
        queryFn: () => getTombolaProof(draw!._id),
        enabled: draw?.status === 'DONE' && !draw.seed && !seed,
    });

    const setDraw = (d: TombolaDraw) => {
        queryClient.setQueryData<TombolaOverview>(key, old => (old ? { ...old, draw: d } : old));
        onChanged();
    };

    if (q.isLoading) return <Skeleton className="h-64 w-full" />;
    if (!q.data) return <Panel><ErrorState error={new Error(impactErrorMessage(q.error, 'Impossible de charger la tombola.'))} onRetry={() => void q.refetch()} retrying={q.isFetching} /></Panel>;
    const o = q.data;
    const t = o.tickets;
    const done = draw?.status === 'DONE';
    const shownSeed = draw?.seed ?? seed ?? proof.data?.seed ?? null;

    const askCommit = () => setConfirm({
        title: 'Fixer la graine du tirage ?',
        tone: 'primary',
        confirmLabel: 'Fixer la graine',
        description: 'Le serveur tire une graine secrète et publie tout de suite son empreinte (sha256). Le tirage partira de cette graine : personne ne pourra la choisir après coup. À faire de préférence pendant que les votes payants sont ouverts, avant que les tickets soient connus.',
        body: o.paidRoundClosed
            ? <Notice tone="warning">Les votes payants sont déjà clos : la tombola sera marquée publiquement comme « graine fixée après la clôture des tickets ».</Notice>
            : <Notice tone="success">Les votes payants sont encore ouverts : c’est le bon moment.</Notice>,
        onConfirm: async () => {
            try {
                setDraw(await commitTombola(edition._id));
                toast.success('Graine fixée : son empreinte est publique.');
            } catch (err) {
                throw new Error(impactErrorMessage(err, 'La graine n’a pas pu être fixée.'));
            }
        },
    });

    const askDraw = () => setConfirm({
        title: 'Lancer le tirage ?',
        tone: 'primary',
        confirmLabel: 'Lancer le tirage',
        description: `Les ${formatNumber(t.totalTickets)} tickets sont figés et les gagnants tirés à partir de la graine. Le résultat est enregistré pour de bon et la graine est révélée. Les gagnants ne sont prévenus qu’au moment où vous les affichez. Votre code d’authentification vous sera demandé.`,
        onConfirm: async () => {
            try {
                const d = await drawTombola(edition._id);
                if (d.seed) setSeed(d.seed);
                setDraw(d);
                toast.success('Tirage effectué. Affichez maintenant les gagnants un par un.');
            } catch (err) {
                throw new Error(impactErrorMessage(err, 'Le tirage n’a pas pu avoir lieu.'));
            }
        },
    });

    const revealNext = async () => {
        setRevealing(true);
        try {
            const d = await revealNextWinner(edition._id);
            setDraw(d);
            const w = d.winners[d.revealedCount - 1];
            toast.success(w ? `Affiché : ${w.prizeLabel} → ${w.displayName ?? 'non attribué'}.` : 'Gagnant affiché.');
        } catch (err) {
            toast.error(impactErrorMessage(err, 'Le gagnant suivant n’a pas pu être affiché.'));
            void q.refetch();
        } finally {
            setRevealing(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric label="Tickets" icon={Ticket01Icon} tone="primary" value={formatNumber(t.totalTickets)} hint="1 vote payant compté = 1 ticket" />
                <Metric label="Participants" value={formatNumber(t.participants)} />
                <Metric label="Lots" value={formatNumber(o.prizes.length)} hint="Tirés dans l’ordre" />
                <Metric label="Délai entre deux gains" value={`${formatNumber(o.cooldownDays)} j`} hint="Même catégorie de lot" />
            </div>

            <Panel>
                <PanelHeader
                    title="Tickets et chances"
                    description={done ? 'Tickets figés au tirage.' : 'Compte provisoire tant que le TOP 3 n’est pas désigné.'}
                />
                <PanelBody className="space-y-4">
                    <p className="text-sm text-fg-muted">
                        Poids du n-ième ticket d’un membre : {tiersText(o.tiers)}. Chaque ticket de plus rapporte moins à un gros acheteur, et chacun garde sa chance.
                    </p>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                            <p className="text-sm font-medium text-fg">Plus gros détenteurs</p>
                            {t.topHolders.length === 0 ? <p className="text-sm text-fg-muted">Aucun ticket pour l’instant.</p> : (
                                <ul className="divide-y divide-line rounded-panel border border-line text-sm">
                                    {t.topHolders.map(h => (
                                        <li key={h.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                                            <Link to={`/userpage/${h.userId}`} className="truncate text-primary hover:underline">{h.name || `…${h.userId.slice(-6)}`}</Link>
                                            <span className="shrink-0 tabular-nums text-fg-muted">
                                                {formatNumber(h.tickets)} {plural(h.tickets, 'ticket')} · <b className="text-fg">{formatNumber(h.sharePct, 2)} %</b> des chances
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <div className="space-y-2">
                            <p className="text-sm font-medium text-fg">Lots, dans l’ordre du tirage</p>
                            <ol className="divide-y divide-line rounded-panel border border-line text-sm">
                                {o.prizes.map((p, i) => (
                                    <li key={p.key} className="flex items-center justify-between gap-3 px-3 py-2">
                                        <span>{i + 1}. {p.label}</span>
                                        <Badge tone="outline">{p.category}</Badge>
                                    </li>
                                ))}
                            </ol>
                            <p className="text-xs text-fg-muted">
                                {done ? 'Lots verrouillés depuis le tirage.' : 'Modifiables dans « Règles et paramètres » jusqu’au tirage.'} Un membre gagne un lot au plus par tirage.
                            </p>
                        </div>
                    </div>
                </PanelBody>
            </Panel>

            <Panel>
                <PanelHeader
                    title="Tirage"
                    description="Tirage vérifiable : la graine est fixée et son empreinte publiée avant, puis révélée après."
                    actions={(
                        <Button asChild variant="outline" size="sm" className="h-11 sm:h-8">
                            <a href={tombolaScreenUrl()} target="_blank" rel="noreferrer noopener">
                                <HugeiconsIcon icon={LinkSquare02Icon} size={14} aria-hidden="true" />Écran du tirage
                            </a>
                        </Button>
                    )}
                />
                <PanelBody className="space-y-3">
                    <Step n={1} title="Fixer la graine" done={!!draw}>
                        {draw ? (
                            <div className="space-y-1 text-sm">
                                <p className="text-fg-muted">Empreinte publiée le {formatDateTime(draw.committedAt)} :</p>
                                <p className="break-all rounded-md bg-surface-2 px-3 py-2 font-mono text-xs text-fg" data-testid="seed-commitment">{draw.seedCommitment}</p>
                                {draw.committedBeforeTicketsClosed
                                    ? <Badge tone="success">Fixée avant la clôture des tickets</Badge>
                                    : <Badge tone="warning">Fixée après la clôture des tickets</Badge>}
                            </div>
                        ) : o.canCommit ? (
                            <div className="space-y-2">
                                {o.paidRoundClosed && <Notice tone="warning">Les votes payants sont clos : la garantie est moins forte (la graine sera fixée après la clôture des tickets).</Notice>}
                                {canWrite && <Button variant="primary" size="lg" onClick={askCommit}>Fixer la graine</Button>}
                            </div>
                        ) : (
                            <p className="text-sm text-fg-muted">La graine se fixe une fois la qualification ouverte.</p>
                        )}
                    </Step>

                    <Step n={2} title="Lancer le tirage" done={done}>
                        {done ? (
                            <div className="space-y-2 text-sm">
                                <p className="text-fg-muted">
                                    Tiré le {formatDateTime(draw!.drawnAt)} sur {formatNumber(draw!.totalTickets)} tickets ({formatNumber(draw!.participants)} participants).
                                </p>
                                <p className="text-fg-muted">Graine révélée :</p>
                                <p className="break-all rounded-md bg-surface-2 px-3 py-2 font-mono text-xs text-fg" data-testid="seed">
                                    {shownSeed ?? (proof.isLoading ? '…' : 'Voir la preuve publique')}
                                </p>
                                <a href={tombolaProofUrl(draw!._id)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                                    <HugeiconsIcon icon={LinkSquare02Icon} size={14} aria-hidden="true" />Preuve publique du tirage
                                </a>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {o.blockers.map(b => <Notice key={b.code} tone="warning">{b.message}</Notice>)}
                                {canWrite && (
                                    <Button variant="primary" size="lg" onClick={askDraw} disabled={!o.canDraw}
                                        title={!o.canDraw ? 'Réglez d’abord les points signalés.' : undefined}>
                                        Lancer le tirage
                                    </Button>
                                )}
                            </div>
                        )}
                    </Step>

                    <Step n={3} title="Afficher les gagnants en direct" done={done && draw!.revealedCount >= draw!.winnersCount}>
                        {!done ? (
                            <p className="text-sm text-fg-muted">Après le tirage, affichez les gagnants un par un sur l’écran du tirage. Chaque gagnant est prévenu au moment où il s’affiche.</p>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                    {canWrite && (
                                        <Button variant="primary" size="lg" className="h-16 px-8 text-base" onClick={() => void revealNext()} loading={revealing}
                                            disabled={draw!.revealedCount >= draw!.winnersCount}>
                                            Afficher le gagnant suivant
                                        </Button>
                                    )}
                                    <p className="text-lg font-semibold tabular-nums text-fg" aria-live="polite">
                                        {formatNumber(draw!.revealedCount)}/{formatNumber(draw!.winnersCount)} affichés
                                    </p>
                                </div>
                                <TombolaWinners editionId={edition._id} draw={draw!} canWrite={canWrite} onDraw={setDraw} />
                            </div>
                        )}
                    </Step>
                </PanelBody>
            </Panel>

            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
