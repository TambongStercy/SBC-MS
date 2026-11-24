import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    ArrowLeft01Icon, Calendar03Icon, Cancel01Icon, Clock01Icon, MoreHorizontalIcon, RefreshIcon, UserMultipleIcon,
} from '@hugeicons/core-free-icons';
import { Can } from '../components/Can';
import { usePermission } from '../hooks/usePermission';
import {
    Button, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Metric, PageHeader, Panel, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger,
} from '../components/ui';
import {
    ConfirmDialog, DateText, ErrorState, Notice, TodoAction, TodoPanel, formatDateTime, formatNumber, plural, type ConfirmOptions, type TodoItem,
} from '../components/moduleKit';
import AuditTab from '../components/sbcImpact/AuditTab';
import CandidateSheet from '../components/sbcImpact/CandidateSheet';
import CandidatesTab from '../components/sbcImpact/CandidatesTab';
import CompetitionPanel from '../components/sbcImpact/CompetitionPanel';
import ContentsTab from '../components/sbcImpact/ContentsTab';
import SettingsTab from '../components/sbcImpact/SettingsTab';
import Top3Tab from '../components/sbcImpact/Top3Tab';
import FinaleTab from '../components/sbcImpact/FinaleTab';
import TombolaTab from '../components/sbcImpact/TombolaTab';
import { unmarkedFinalists } from '../components/sbcImpact/finaleQueries';
import VotesTab from '../components/sbcImpact/VotesTab';
import { EditionStatusBadge, RoundStatusBadge } from '../components/sbcImpact/shared';
import {
    CLOSED_REASON_LABELS, ROUND_LABELS, ROUND_STAGE, RULES_MIN_LENGTH, STAGE_LABELS, cancelEdition, closeQualification, getEdition,
    getJury, getResult, getTombola, getTop3, listShowcase, impactErrorMessage, isEditionClosed, listCandidates, listPurchases, listSubmissions, openQualification, recountEdition,
    type CandidateRow, type CandidateStatus, type Edition, type RoundKey,
} from '../services/impactV2Api';

type Tab = 'candidats' | 'contenus' | 'votes' | 'top3' | 'finale' | 'tombola' | 'regles' | 'journal';
const TABS: Tab[] = ['candidats', 'contenus', 'votes', 'top3', 'finale', 'tombola', 'regles', 'journal'];
/** Stages of the final (the « Finale » tab exists from the TOP 3 on). */
const FINAL_STAGES = ['TOP3', 'LIVE', 'RESULT'];
/** Tabs that exist once the competition has started. */
const COMPETITION_TABS: Tab[] = ['contenus', 'votes', 'top3', 'tombola'];
/** Candidates still in the running, for the competition metric. */
const RUNNING: CandidateStatus[] = ['OFFICIAL', 'STAGE_2', 'STAGE_3', 'FINALIST', 'WINNER', 'SUSPENDED'];

/** A side read failed: the to-do list goes on without it. */
const orNull = <T,>(p: Promise<T>) => p.catch(() => null);

/**
 * Counts for the metrics and the to-do list. Every list answer carries the
 * counts per status, the seats and `belowRequirementCount` (whole edition);
 * profiles to review need their own count, and the first few seat holders
 * below the requirement are read for their names. During the competition:
 * contents to review, uncertain refunds (week 3 on, a count on any purchases
 * answer), and whether the TOP 3 can be designated (once the paid round is closed).
 */
async function loadWork(e: Edition) {
    const stage = e.stage;
    const week3On = !!stage && ['WEEK3', 'TOP3', 'LIVE', 'RESULT'].includes(stage);
    const top3Due = e.status === 'COMPETITION' && stage === 'WEEK3' && e.rounds?.PAID?.status === 'CLOSED' && !e.top3?.decidedAt;
    const juryDue = e.status === 'FINAL';
    const resultDue = e.status === 'FINAL' && stage === 'LIVE' && !!e.jury?.lockedAt;
    const tombolaDue = !!stage && e.status !== 'CANCELLED';
    const showcaseDue = stage === 'RESULT' || !!e.result?.publishedAt;
    const [all, pending, contents, purchases, top3, jury, result, tombola, showcase] = await Promise.all([
        listCandidates(e._id, { limit: 1 }),
        listCandidates(e._id, { review: 'PENDING', limit: 1 }),
        stage ? orNull(listSubmissions(e._id, { status: 'PENDING' })) : null,
        week3On ? orNull(listPurchases(e._id, { limit: 1 })) : null,
        top3Due ? orNull(getTop3(e._id)) : null,
        juryDue ? orNull(getJury(e._id)) : null,
        resultDue ? orNull(getResult(e._id)) : null,
        tombolaDue ? orNull(getTombola(e._id)) : null,
        showcaseDue ? orNull(listShowcase({ editionId: e._id })) : null,
    ]);
    const draw = tombola?.draw ?? null;
    const below: CandidateRow[] = all.belowRequirementCount > 0
        ? (await listCandidates(e._id, { below: true, limit: 5 })).items
        : [];
    return {
        byStatus: all.byStatus, seats: all.seats, pending: pending.total, belowCount: all.belowRequirementCount, below,
        pendingContents: contents?.length ?? 0,
        uncertainRefunds: purchases?.totals.uncertainRefunds ?? 0,
        top3Ready: !!top3 && top3.blockers.length === 0 && top3.ranking.length > 0 && !top3.decided,
        // The final
        activeJurors: jury ? jury.jurors.filter(j => !j.removedAt).length : null,
        unmarked: jury ? unmarkedFinalists(jury) : [],
        resultReady: !!result && !result.published && result.blockers.length === 0 && result.rows.length > 0,
        // The tombola
        seedDue: !!tombola && !draw && tombola.canCommit && e.rounds?.PAID?.status === 'OPEN',
        drawReady: draw?.status === 'COMMITTED' && !!tombola?.canDraw,
        tombolaDrawn: draw?.status === 'DONE',
        unrevealed: draw?.status === 'DONE' ? Math.max(0, draw.winnersCount - draw.revealedCount) : 0,
        undelivered: draw?.status === 'DONE' ? draw.winners.filter(x => x.userId && x.status === 'PENDING').length : 0,
        // The SBC Impact pages
        pendingNews: (showcase ?? []).reduce((n, p) => n + (p.pendingUpdates ?? 0), 0),
    };
}

/** One SBC Impact Challenge edition: qualification, candidates, rules, journal. */
export default function SbcImpactEditionPage() {
    const { id = '' } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const [params, setParams] = useSearchParams();
    const canWrite = usePermission('impactChallenge') === 'write';
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
    const [openCandidate, setOpenCandidate] = useState<string | null>(null);
    const [recounting, setRecounting] = useState(false);

    const tabParam = params.get('tab') as Tab | null;
    const setTab = (t: string, extra: Record<string, string> = {}) => setParams(prev => {
        const next = new URLSearchParams(prev);
        if (t === 'candidats') next.delete('tab'); else next.set('tab', t);
        for (const [k, v] of Object.entries(extra)) next.set(k, v);
        if (Object.keys(extra).length) next.delete('page');
        return next;
    }, { replace: true });

    const editionQ = useQuery({
        queryKey: ['sbc-impact', 'edition', id],
        queryFn: () => getEdition(id),
        enabled: !!id,
        // After « Clore la qualification » the job closes the edition within ~10 s: follow it.
        refetchInterval: q => {
            const e = q.state.data;
            return e && e.status === 'QUALIFICATION' && new Date(e.schedule.qualificationClosesAt).getTime() <= Date.now() ? 5000 : false;
        },
    });
    const edition = editionQ.data;
    const competitionStarted = !!edition?.stage;
    const finaleVisible = !!edition?.stage && FINAL_STAGES.includes(edition.stage);
    const tab: Tab = tabParam && TABS.includes(tabParam)
        && (competitionStarted || !COMPETITION_TABS.includes(tabParam))
        && (finaleVisible || tabParam !== 'finale') ? tabParam : 'candidats';
    const work = useQuery({
        queryKey: ['sbc-impact', 'work', id, edition?.status, edition?.stage, edition?.rounds?.PAID?.status, edition?.jury?.lockedAt],
        queryFn: () => loadWork(edition!),
        enabled: !!edition && edition.status !== 'DRAFT',
    });

    // A message handed over by the page the admin came from (e.g. "created").
    useEffect(() => {
        const flash = (location.state as { flash?: string } | null)?.flash;
        if (flash) {
            toast.success(flash);
            navigate(location.pathname + location.search, { replace: true, state: null });
        }
    }, [location.state, location.pathname, location.search, navigate]);

    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['sbc-impact'] }); };
    /** An action answered with the edition: show it at once, reload the rest. */
    const editionChanged = (next?: Edition) => {
        if (next) queryClient.setQueryData(['sbc-impact', 'edition', id], next);
        refresh();
    };

    const back = (
        <Link to="/sbc-impact" className="inline-flex h-11 items-center gap-1 text-sm text-fg-muted hover:text-fg sm:h-auto">
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" /> Toutes les éditions
        </Link>
    );

    if (editionQ.isLoading) {
        return (
            <div className="space-y-6" aria-busy="true">
                {back}
                <Skeleton className="h-8 w-72" />
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }
    if (!edition) {
        return (
            <div className="space-y-4">
                {back}
                <Panel><ErrorState error={new Error(impactErrorMessage(editionQ.error, 'Édition introuvable.'))} onRetry={() => void editionQ.refetch()} retrying={editionQ.isFetching} /></Panel>
            </div>
        );
    }

    const e: Edition = edition;
    const closed = isEditionClosed(e.status);
    const closing = e.status === 'QUALIFICATION' && new Date(e.schedule.qualificationClosesAt).getTime() <= Date.now();
    const rulesLength = (e.rulesText ?? '').trim().length;
    const canRecount = e.status === 'QUALIFICATION' || e.status === 'QUALIFICATION_CLOSED';

    /** Runs an action, reloads, and lets ConfirmDialog show the failure. */
    const run = (fn: () => Promise<unknown>, success: string, fallback: string) => async () => {
        try {
            await fn();
            toast.success(success);
        } catch (err) {
            throw new Error(impactErrorMessage(err, fallback));
        } finally {
            refresh();
        }
    };

    const askOpen = () => setConfirm({
        title: 'Ouvrir la qualification ?',
        tone: 'primary',
        confirmLabel: 'Ouvrir la qualification',
        description: 'L’édition devient le Challenge en cours dans l’app : les membres avec un pack actif peuvent déposer leur profil, et leurs invitations sont comptées.',
        body: (
            <div className="space-y-3 text-sm">
                <Notice tone="warning">
                    Le règlement est publié et ne pourra plus être modifié, comme les dates de qualification, le nombre de candidats, les invitations
                    requises, la liste d’attente, les catégories et les questions du profil.
                </Notice>
                {rulesLength < RULES_MIN_LENGTH && (
                    <Notice tone="danger">Le règlement ne compte que {formatNumber(rulesLength)} caractères : il en faut {RULES_MIN_LENGTH} au moins. Rédigez-le dans « Règles et paramètres ».</Notice>
                )}
                <p className="text-fg-muted">Qualification jusqu’au {formatDateTime(e.schedule.qualificationClosesAt)}. Une seule édition peut être en cours à la fois.</p>
            </div>
        ),
        onConfirm: run(() => openQualification(e._id), 'La qualification est ouverte.', 'La qualification n’a pas pu être ouverte.'),
    });
    const askClose = () => setConfirm({
        title: 'Clore la qualification maintenant ?',
        tone: 'primary',
        confirmLabel: 'Clore la qualification',
        description: 'La qualification se termine maintenant au lieu du ' + formatDateTime(e.schedule.qualificationClosesAt)
            + '. Le système finit d’attribuer les places dans les secondes qui suivent ; ceux qui n’ont pas atteint le seuil passent « Inscriptions fermées ». C’est définitif.',
        reason: { label: 'Raison', required: true, minLength: 5 },
        onConfirm: (reason: string) => run(() => closeQualification(e._id, reason), 'Clôture demandée : la qualification se termine dans quelques secondes.', 'La qualification n’a pas pu être close.')(),
    });
    const askCancel = () => setConfirm({
        title: 'Annuler cette édition ?',
        confirmLabel: 'Annuler l’édition',
        description: `« ${e.name} » s’arrête et ne pourra plus être rouverte.${e.status === 'DRAFT' ? '' : ' Les candidats encore en lice sont prévenus (notification et e-mail) avec la raison.'}`,
        reason: { label: e.status === 'DRAFT' ? 'Raison' : 'Raison (envoyée aux candidats)', required: true, minLength: 10 },
        onConfirm: (reason: string) => run(() => cancelEdition(e._id, reason), 'L’édition est annulée.', 'L’édition n’a pas pu être annulée.')(),
    });
    const recount = async () => {
        setRecounting(true);
        try {
            const { updated } = await recountEdition(e._id);
            toast.success(`Invitations recomptées : ${formatNumber(updated)} ${plural(updated, 'candidat mis', 'candidats mis')} à jour.`);
        } catch (err) {
            toast.error(impactErrorMessage(err, 'Le recomptage a échoué.'));
        } finally {
            setRecounting(false);
            refresh();
        }
    };

    const primary = e.status === 'DRAFT'
        ? <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={askOpen}>Ouvrir la qualification</Button>
        : e.status === 'QUALIFICATION' && !closing
            ? <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={askClose}>Clore la qualification</Button>
            : null;

    // ---------- À traiter ----------
    const w = work.data;
    const todo: TodoItem[] = [];
    if (e.status === 'DRAFT' && rulesLength < RULES_MIN_LENGTH) {
        todo.push({
            key: 'rules', count: 1, tone: 'info',
            label: 'Règlement à rédiger',
            hint: `${formatNumber(rulesLength)} / ${RULES_MIN_LENGTH} caractères minimum pour ouvrir la qualification.`,
            action: <TodoAction onClick={() => setTab('regles')}>Rédiger</TodoAction>,
        });
    }
    if (w && w.pending > 0) {
        todo.push({
            key: 'review', count: w.pending,
            label: `${plural(w.pending, 'Profil')} à vérifier`,
            hint: 'Photo, projet et présentation à valider, ou à faire corriger.',
            action: <TodoAction onClick={() => setTab('candidats', { avis: 'PENDING' })}>Vérifier</TodoAction>,
        });
    }
    if (w && w.belowCount > 0) {
        todo.push({
            key: 'below', count: w.belowCount, tone: 'danger',
            label: `${plural(w.belowCount, 'Candidat')} sous le seuil d’invitations`,
            hint: `${w.below.map(c => c.profile.name).join(', ')}${w.belowCount > w.below.length ? '…' : ''} : une activation de filleul a été annulée après l’attribution de la place.`,
            action: w.belowCount === 1 && w.below[0]
                ? <TodoAction onClick={() => setOpenCandidate(w.below[0]._id)}>Examiner</TodoAction>
                : <TodoAction onClick={() => setTab('candidats', { sous: '1' })}>Voir</TodoAction>,
        });
    }

    // Competition (Phase 2)
    if (w && w.pendingContents > 0) {
        todo.push({
            key: 'contents', count: w.pendingContents,
            label: `${plural(w.pendingContents, 'Contenu')} à valider`,
            hint: 'Vidéos et projets des candidats : validez-les pour qu’ils soient publiés et soumis au vote.',
            action: <TodoAction onClick={() => setTab('contenus')}>Examiner</TodoAction>,
        });
    }
    const currentRound = (Object.keys(ROUND_STAGE) as RoundKey[]).find(k => ROUND_STAGE[k] === e.stage);
    const roundNow = currentRound ? e.rounds?.[currentRound] : undefined;
    if (e.status === 'COMPETITION' && currentRound && (roundNow?.status ?? 'SCHEDULED') === 'SCHEDULED' && !roundNow?.closesAt) {
        todo.push({
            key: 'round-dates', count: 1, tone: 'info',
            label: `Dates du ${ROUND_LABELS[currentRound].toLowerCase()} à programmer`,
            hint: 'Sans dates, le vote de cette semaine ne s’ouvre pas.',
            action: <TodoAction onClick={() => document.getElementById('competition')?.scrollIntoView({ behavior: 'smooth' })}>Programmer</TodoAction>,
        });
    }
    if (w && w.uncertainRefunds > 0) {
        todo.push({
            key: 'refunds', count: w.uncertainRefunds, tone: 'danger',
            label: `${plural(w.uncertainRefunds, 'Remboursement incertain', 'Remboursements incertains')}`,
            hint: 'L’argent n’a pas pu être confirmé sur le solde de l’acheteur ; le système réessaie chaque minute. Prévenez la technique s’il reste.',
            action: <TodoAction onClick={() => setTab('votes', { achats: 'incertains' })}>Voir</TodoAction>,
        });
    }
    // The final (Phase 3)
    if (e.status === 'FINAL' && e.stage === 'TOP3' && w?.activeJurors === 0) {
        todo.push({
            key: 'jury', count: 1, tone: 'info',
            label: 'Jury à composer',
            hint: 'Ajoutez au moins un juré (un compte SBC, jamais un finaliste) pour démarrer la finale.',
            action: <TodoAction onClick={() => setTab('finale')}>Composer</TodoAction>,
        });
    }
    if (e.stage === 'LIVE' && !e.jury?.lockedAt && w && w.unmarked.length > 0) {
        todo.push({
            key: 'unmarked', count: w.unmarked.length,
            label: `${plural(w.unmarked.length, 'Finaliste')} pas encore ${plural(w.unmarked.length, 'noté')}`,
            hint: `${w.unmarked.map(f => f.name).join(', ')} : aucune note d’un juré actif pour l’instant.`,
            action: <TodoAction onClick={() => setTab('finale')}>Suivre</TodoAction>,
        });
    }
    if (e.stage === 'LIVE' && !e.jury?.lockedAt && w && w.unmarked.length === 0 && (w.activeJurors ?? 0) > 0) {
        todo.push({
            key: 'lock', count: 1, tone: 'info',
            label: 'Notes du jury à verrouiller',
            hint: 'Chaque finaliste a au moins une note. Verrouillez une fois tous les jurés passés.',
            action: <TodoAction onClick={() => setTab('finale')}>Verrouiller</TodoAction>,
        });
    }
    if (w?.resultReady) {
        todo.push({
            key: 'result', count: 1, tone: 'info',
            label: 'Résultat prêt à être publié',
            hint: 'Les notes sont verrouillées et rien ne bloque la publication.',
            action: <TodoAction onClick={() => setTab('finale')}>Publier</TodoAction>,
        });
    }
    // The tombola (Phase 4)
    if (w?.seedDue) {
        todo.push({
            key: 'seed', count: 1, tone: 'danger',
            label: 'Graine de la tombola à fixer',
            hint: 'Les votes payants sont ouverts : fixez la graine maintenant, avant la clôture des tickets. C’est ce qui garantit que le tirage n’a pas pu être arrangé.',
            action: <TodoAction onClick={() => setTab('tombola')}>Fixer</TodoAction>,
        });
    }
    if (w?.drawReady) {
        todo.push({
            key: 'draw', count: 1, tone: 'info',
            label: 'Tirage de la tombola prêt',
            hint: 'Le TOP 3 est désigné et la graine est fixée : le tirage peut avoir lieu (en général à la fin de la finale).',
            action: <TodoAction onClick={() => setTab('tombola')}>Tirer</TodoAction>,
        });
    }
    if (w && w.unrevealed > 0) {
        todo.push({
            key: 'reveal', count: w.unrevealed, tone: 'info',
            label: `${plural(w.unrevealed, 'Gagnant')} de la tombola pas encore ${plural(w.unrevealed, 'affiché')}`,
            hint: 'Chaque gagnant est prévenu au moment où il s’affiche sur l’écran du tirage.',
            action: <TodoAction onClick={() => setTab('tombola')}>Afficher</TodoAction>,
        });
    }
    if (w && w.undelivered > 0) {
        todo.push({
            key: 'prizes', count: w.undelivered,
            label: `${plural(w.undelivered, 'Lot')} de la tombola à remettre`,
            hint: 'Marquez chaque lot « Remis », ou « Non remis » avec la raison.',
            action: <TodoAction onClick={() => setTab('tombola')}>Voir</TodoAction>,
        });
    }
    // The showcase (Phase 5)
    if (w && w.pendingNews > 0) {
        todo.push({
            key: 'news', count: w.pendingNews,
            label: `${plural(w.pendingNews, 'Nouvelle')} des finalistes à valider`,
            hint: 'Proposées depuis leur page SBC Impact : publiez-les, ou refusez-les avec une raison qu’ils liront.',
            action: <TodoAction href="/sbc-impact/vitrine">Valider</TodoAction>,
        });
    }
    if (w?.top3Ready) {
        todo.push({
            key: 'top3', count: 1, tone: 'info',
            label: 'TOP 3 prêt à être désigné',
            hint: 'Les votes payants sont clos et rien ne bloque la décision.',
            action: <TodoAction onClick={() => setTab('top3')}>Désigner</TodoAction>,
        });
    }

    const count = (s: CandidateStatus) => w?.byStatus[s] ?? 0;
    const metric = (v: ReactNode) => (work.isLoading ? <Skeleton className="h-7 w-16" /> : v);
    const seatsMax = w?.seats.max ?? e.settings.maxCandidates;

    return (
        <div className="space-y-6">
            <div>
                {back}
                <PageHeader
                    className="mb-0 mt-2"
                    title={<span className="flex flex-wrap items-center gap-3">{e.name}<EditionStatusBadge status={e.status} /></span>}
                    description={e.stage
                        ? `Compétition · ${STAGE_LABELS[e.stage]}`
                        : `Qualification du ${formatDateTime(e.schedule.qualificationOpensAt)} au ${formatDateTime(e.schedule.qualificationClosesAt)}`}
                    actions={(
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                            {primary && <Can module="impactChallenge" write>{primary}</Can>}
                            <div className="flex gap-2">
                                <Can module="impactChallenge" write>
                                    {canRecount && (
                                        <Button variant="outline" size="lg" className="flex-1 sm:flex-none" onClick={() => void recount()} loading={recounting}>
                                            <HugeiconsIcon icon={RefreshIcon} size={16} aria-hidden="true" />Recompter les invitations
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
                                        {canWrite && !closed && <MenuSeparator />}
                                        {canWrite && !closed && (
                                            <MenuItem destructive onSelect={askCancel}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />Annuler l’édition</MenuItem>
                                        )}
                                    </MenuContent>
                                </Menu>
                            </div>
                        </div>
                    )}
                />
            </div>

            {closing && (
                <Notice tone="info">La qualification se termine : le système attribue les dernières places et clôt l’édition dans quelques secondes.</Notice>
            )}
            {e.status === 'QUALIFICATION' && !closing && e.registrationClosedReason && (
                <Notice tone="info">Nouveaux profils refusés : {CLOSED_REASON_LABELS[e.registrationClosedReason] ?? e.registrationClosedReason}. Les candidats déjà inscrits peuvent encore entrer en liste d’attente.</Notice>
            )}
            {e.status === 'CANCELLED' && e.cancellation && (
                <Notice tone="danger">Annulée le {formatDateTime(e.cancellation.at)} : « {e.cancellation.reason} »</Notice>
            )}

            {!closed && (e.status === 'DRAFT' || !work.isError) && <TodoPanel items={todo} loading={work.isLoading && e.status !== 'DRAFT'} />}

            {(e.stage || e.status === 'QUALIFICATION_CLOSED') && (
                <div id="competition" className="scroll-mt-4">
                    <CompetitionPanel
                        edition={e}
                        canWrite={canWrite}
                        onChanged={editionChanged}
                        onOpenCandidate={setOpenCandidate}
                        onShowCandidates={filter => setTab('candidats', filter)}
                        onShowTop3={() => setTab('top3')}
                        onShowFinal={() => setTab('finale')}
                    />
                </div>
            )}

            {e.stage ? (
                <div className={`grid grid-cols-2 gap-3 lg:grid-cols-4 ${work.isFetching && !work.isLoading ? 'opacity-60' : ''}`}>
                    <Metric
                        label="Candidats en course"
                        icon={UserMultipleIcon}
                        tone="primary"
                        value={metric(formatNumber(RUNNING.reduce((n, st) => n + count(st), 0)))}
                        hint={e.top3?.decidedAt ? `${formatNumber(count('FINALIST'))} ${plural(count('FINALIST'), 'finaliste')}` : STAGE_LABELS[e.stage]}
                        onClick={() => setTab('candidats')}
                    />
                    <Metric
                        label="Contenus à valider"
                        tone={(w?.pendingContents ?? 0) > 0 ? 'warning' : 'neutral'}
                        value={metric(formatNumber(w?.pendingContents ?? 0))}
                        onClick={() => setTab('contenus')}
                    />
                    {((FINAL_STAGES.includes(e.stage) ? ['PAID', 'FINAL'] : ['FREE', 'PAID']) as RoundKey[]).map(k => {
                        const r = e.rounds?.[k];
                        return (
                            <Metric
                                key={k}
                                label={ROUND_LABELS[k]}
                                value={<RoundStatusBadge status={r?.status ?? 'SCHEDULED'} />}
                                hint={r?.status === 'CLOSED'
                                    ? `Clos le ${formatDateTime(r.closedAt ?? r.closesAt)}`
                                    : r?.closesAt ? <>Fin <DateText value={r.closesAt} /></> : 'Dates à programmer'}
                                onClick={() => setTab('votes')}
                            />
                        );
                    })}
                </div>
            ) : (
            <div className={`grid grid-cols-2 gap-3 lg:grid-cols-5 ${work.isFetching && !work.isLoading ? 'opacity-60' : ''}`}>
                <Metric
                    label="Places prises"
                    icon={UserMultipleIcon}
                    tone="primary"
                    value={metric(`${formatNumber(w?.seats.taken ?? 0)} / ${formatNumber(seatsMax)}`)}
                    hint={`${formatNumber(e.settings.invitationsRequired)} invitations pour une place`}
                    onClick={() => setTab('candidats', { statut: 'OFFICIAL' })}
                />
                <Metric
                    label="Liste d’attente"
                    value={metric(formatNumber(count('WAITLIST')))}
                    hint={`${formatNumber(e.settings.waitlistSize)} au plus`}
                    onClick={() => setTab('candidats', { statut: 'WAITLIST' })}
                />
                <Metric
                    label="En qualification"
                    value={metric(formatNumber(count('QUALIFYING')))}
                    hint="Pas encore au seuil"
                    onClick={() => setTab('candidats', { statut: 'QUALIFYING' })}
                />
                <Metric
                    label="Profils à vérifier"
                    tone={(w?.pending ?? 0) > 0 ? 'warning' : 'neutral'}
                    value={metric(formatNumber(w?.pending ?? 0))}
                    onClick={() => setTab('candidats', { avis: 'PENDING' })}
                />
                <Metric
                    label="Fin de la qualification"
                    icon={e.status === 'QUALIFICATION' ? Clock01Icon : Calendar03Icon}
                    value={<span className="text-lg">{formatDateTime(e.schedule.qualificationClosesAt)}</span>}
                    hint={<DateText value={e.schedule.qualificationClosesAt} />}
                />
            </div>
            )}
            {work.isError && e.status !== 'DRAFT' && (
                <Notice tone="warning">Les compteurs n’ont pas pu être chargés : {impactErrorMessage(work.error, 'erreur inconnue')}.</Notice>
            )}

            <Tabs value={tab} onValueChange={t => setTab(t)}>
                <TabsList>
                    <TabsTrigger value="candidats" className="h-11">Candidats{w ? ` (${formatNumber(Object.values(w.byStatus).reduce((s, n) => s + (n ?? 0), 0))})` : ''}</TabsTrigger>
                    {competitionStarted && (
                        <>
                            <TabsTrigger value="contenus" className="h-11">Contenus{w?.pendingContents ? ` (${formatNumber(w.pendingContents)})` : ''}</TabsTrigger>
                            <TabsTrigger value="votes" className="h-11">Votes</TabsTrigger>
                            <TabsTrigger value="top3" className="h-11">TOP 3</TabsTrigger>
                            {finaleVisible && <TabsTrigger value="finale" className="h-11">Finale</TabsTrigger>}
                            <TabsTrigger value="tombola" className="h-11">Tombola</TabsTrigger>
                        </>
                    )}
                    <TabsTrigger value="regles" className="h-11">Règles et paramètres</TabsTrigger>
                    <TabsTrigger value="journal" className="h-11">Journal</TabsTrigger>
                </TabsList>
                <TabsContent value="candidats" className="mt-4">
                    <CandidatesTab edition={e} onOpen={setOpenCandidate} />
                </TabsContent>
                {competitionStarted && (
                    <>
                        <TabsContent value="contenus" className="mt-4">
                            <ContentsTab editionId={e._id} canWrite={canWrite} onChanged={refresh} />
                        </TabsContent>
                        <TabsContent value="votes" className="mt-4">
                            <VotesTab edition={e} canWrite={canWrite} onChanged={refresh} />
                        </TabsContent>
                        <TabsContent value="top3" className="mt-4">
                            <Top3Tab edition={e} canWrite={canWrite} onChanged={editionChanged} onOpenCandidate={setOpenCandidate} />
                        </TabsContent>
                        <TabsContent value="tombola" className="mt-4">
                            <TombolaTab edition={e} canWrite={canWrite} onChanged={refresh} />
                        </TabsContent>
                        {finaleVisible && (
                            <TabsContent value="finale" className="mt-4">
                                <FinaleTab
                                    edition={e}
                                    canWrite={canWrite}
                                    onChanged={editionChanged}
                                    onEdition={next => queryClient.setQueryData(['sbc-impact', 'edition', id], next)}
                                />
                            </TabsContent>
                        )}
                    </>
                )}
                <TabsContent value="regles" className="mt-4">
                    <SettingsTab edition={e} canWrite={canWrite} onSaved={editionChanged} prizesLocked={!!w?.tombolaDrawn} />
                </TabsContent>
                <TabsContent value="journal" className="mt-4">
                    <AuditTab editionId={e._id} onOpenCandidate={setOpenCandidate} />
                </TabsContent>
            </Tabs>

            {openCandidate && (
                <CandidateSheet
                    candidateId={openCandidate}
                    edition={e}
                    canWrite={canWrite}
                    onClose={() => setOpenCandidate(null)}
                    onChanged={refresh}
                />
            )}

            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
