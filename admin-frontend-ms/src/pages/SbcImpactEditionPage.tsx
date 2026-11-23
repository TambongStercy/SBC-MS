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
import SettingsTab from '../components/sbcImpact/SettingsTab';
import { EditionStatusBadge } from '../components/sbcImpact/shared';
import {
    CLOSED_REASON_LABELS, RULES_MIN_LENGTH, cancelEdition, closeQualification, getEdition, impactErrorMessage, isEditionClosed,
    listCandidates, openQualification, recountEdition, type CandidateRow, type CandidateStatus, type Edition,
} from '../services/impactV2Api';

type Tab = 'candidats' | 'regles' | 'journal';
const TABS: Tab[] = ['candidats', 'regles', 'journal'];

/**
 * Counts for the metrics and the to-do list. Every list answer carries the
 * counts per status, the seats and `belowRequirementCount` (whole edition);
 * profiles to review need their own count, and the first few seat holders
 * below the requirement are read for their names.
 */
async function loadWork(editionId: string) {
    const [all, pending] = await Promise.all([
        listCandidates(editionId, { limit: 1 }),
        listCandidates(editionId, { review: 'PENDING', limit: 1 }),
    ]);
    const below: CandidateRow[] = all.belowRequirementCount > 0
        ? (await listCandidates(editionId, { below: true, limit: 5 })).items
        : [];
    return { byStatus: all.byStatus, seats: all.seats, pending: pending.total, belowCount: all.belowRequirementCount, below };
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
    const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'candidats';
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
    const work = useQuery({
        queryKey: ['sbc-impact', 'work', id, edition?.status],
        queryFn: () => loadWork(id),
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
                    description={`Qualification du ${formatDateTime(e.schedule.qualificationOpensAt)} au ${formatDateTime(e.schedule.qualificationClosesAt)}`}
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
            {work.isError && e.status !== 'DRAFT' && (
                <Notice tone="warning">Les compteurs n’ont pas pu être chargés : {impactErrorMessage(work.error, 'erreur inconnue')}.</Notice>
            )}

            <Tabs value={tab} onValueChange={t => setTab(t)}>
                <TabsList>
                    <TabsTrigger value="candidats" className="h-11">Candidats{w ? ` (${formatNumber(Object.values(w.byStatus).reduce((s, n) => s + (n ?? 0), 0))})` : ''}</TabsTrigger>
                    <TabsTrigger value="regles" className="h-11">Règles et paramètres</TabsTrigger>
                    <TabsTrigger value="journal" className="h-11">Journal</TabsTrigger>
                </TabsList>
                <TabsContent value="candidats" className="mt-4">
                    <CandidatesTab edition={e} onOpen={setOpenCandidate} />
                </TabsContent>
                <TabsContent value="regles" className="mt-4">
                    <SettingsTab edition={e} canWrite={canWrite} onSaved={saved => { queryClient.setQueryData(['sbc-impact', 'edition', id], saved); refresh(); }} />
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
