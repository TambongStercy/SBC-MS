import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, CheckmarkCircle02Icon, Edit02Icon, PauseIcon, PlayIcon } from '@hugeicons/core-free-icons';
import { Button, Dialog, MenuItem, SheetContent, Skeleton } from '../ui';
import {
    ConfirmDialog, DateText, DetailList, ErrorState, Notice, RowMenu, SheetSection, formatDateTime, formatNumber,
    type ConfirmOptions,
} from '../moduleKit';
import { getCountryName } from '../../utils/countryUtils';
import {
    CANDIDATE_STATUS_LABELS, actorLabel, auditActionLabel, disqualifyCandidate, getCandidate, impactErrorMessage,
    readImpactError, reinstateCandidate, reviewCandidate, suspendCandidate,
    type AuditEntry, type Candidate, type CandidateStatus, type Edition,
} from '../../services/impactV2Api';
import { BelowRequirementBadge, CandidatePhoto, CandidateStatusBadge, ReviewBadge } from './shared';

/** Statuses the backend can suspend (candidate.service SUSPENDABLE); disqualify also takes SUSPENDED. */
const SUSPENDABLE: CandidateStatus[] = ['QUALIFYING', 'WAITLIST', 'OFFICIAL', 'STAGE_2', 'STAGE_3', 'FINALIST'];
/** No review decision left to take. */
const GONE: CandidateStatus[] = ['DISQUALIFIED', 'WITHDRAWN'];

const statusWord = (s: string) => CANDIDATE_STATUS_LABELS[s as CandidateStatus] ?? s;

function Paragraph({ children }: { children: ReactNode }) {
    return <p className="whitespace-pre-line rounded-panel border border-line px-4 py-3 text-sm text-fg">{children || '—'}</p>;
}

function AuditList({ items }: { items: AuditEntry[] }) {
    if (!items.length) return <p className="text-sm text-fg-muted">Aucune action enregistrée.</p>;
    return (
        <ul className="divide-y divide-line rounded-panel border border-line">
            {items.map(a => (
                <li key={a._id} className="space-y-0.5 px-4 py-2.5 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-fg">{auditActionLabel(a.action)}</span>
                        <DateText value={a.at} className="text-xs text-fg-muted" />
                    </div>
                    <p className="text-xs text-fg-muted">{actorLabel(a)}</p>
                    {a.reason && <p className="text-xs text-fg">« {a.reason} »</p>}
                </li>
            ))}
        </ul>
    );
}

/**
 * One candidate: photo, full profile, invitations, seat, history and audit,
 * and (write access) the review and moderation actions.
 */
export default function CandidateSheet({ candidateId, edition, canWrite, onClose, onChanged }: {
    candidateId: string;
    edition: Edition;
    canWrite: boolean;
    onClose: () => void;
    /** Something changed: the page reloads its lists and counts. */
    onChanged: () => void;
}) {
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
    const details = useQuery({ queryKey: ['sbc-impact', 'candidate', candidateId], queryFn: () => getCandidate(candidateId) });
    const c = details.data?.candidate;

    /** Runs an action; a profile changed meanwhile (STALE) reloads it so the admin decides on what they see. */
    const act = (fn: () => Promise<Candidate>, success: string, fallback: string) => async () => {
        try {
            await fn();
            toast.success(success);
        } catch (err) {
            const e = readImpactError(err, fallback);
            if (e.code === 'STALE') {
                toast.error(e.message);
                await details.refetch();
                onChanged();
                return;
            }
            throw new Error(impactErrorMessage(err, fallback));
        }
        await details.refetch();
        onChanged();
    };

    const askApprove = (x: Candidate) => setConfirm({
        title: `Valider le profil de ${x.profile.name} ?`,
        tone: 'primary',
        confirmLabel: 'Valider le profil',
        description: 'Le candidat reçoit « Candidature validée » (notification et e-mail). Une modification de sa part remettra le profil à vérifier.',
        onConfirm: act(() => reviewCandidate(x._id, { decision: 'approve', profileUpdatedAt: x.profileUpdatedAt }), 'Profil validé.', 'La validation a échoué.'),
    });
    const askChanges = (x: Candidate) => setConfirm({
        title: 'Demander des modifications ?',
        tone: 'primary',
        confirmLabel: 'Envoyer la demande',
        description: 'Le candidat reçoit votre message (notification et e-mail) et peut corriger son profil.',
        reason: { label: 'Ce qu’il faut modifier', required: true, minLength: 10, placeholder: 'ex. La photo est floue, merci d’en mettre une où le visage est net.' },
        onConfirm: (reason: string) => act(
            () => reviewCandidate(x._id, { decision: 'changes', reason, profileUpdatedAt: x.profileUpdatedAt }),
            'Demande envoyée au candidat.', 'La demande a échoué.',
        )(),
    });
    const askSuspend = (x: Candidate) => setConfirm({
        title: `Suspendre ${x.profile.name} ?`,
        confirmLabel: 'Suspendre',
        description: 'Le candidat garde sa place mais ne participe plus tant qu’il est suspendu. Il est prévenu avec la raison. La suspension se lève avec « Rétablir ».',
        reason: { label: 'Raison (envoyée au candidat)', required: true, minLength: 10 },
        onConfirm: (reason: string) => act(() => suspendCandidate(x._id, reason), 'Candidat suspendu.', 'La suspension a échoué.')(),
    });
    const askReinstate = (x: Candidate) => setConfirm({
        title: `Rétablir ${x.profile.name} ?`,
        tone: 'primary',
        confirmLabel: 'Rétablir',
        description: `Il revient au statut « ${statusWord(x.suspendedFrom ?? '')} » et en est prévenu.`,
        reason: { label: 'Raison', required: true, minLength: 5 },
        onConfirm: (reason: string) => act(() => reinstateCandidate(x._id, reason), 'Candidat rétabli.', 'Le rétablissement a échoué.')(),
    });
    const askDisqualify = (x: Candidate) => setConfirm({
        title: `Disqualifier ${x.profile.name} ?`,
        confirmLabel: 'Disqualifier',
        description: 'C’est définitif : la candidature ne pourra pas être rétablie.'
            + (x.seatNumber ? ` Sa place (n° ${x.seatNumber}) revient au premier de la liste d’attente.` : '')
            + ' Le candidat est prévenu avec la raison.',
        reason: { label: 'Raison (envoyée au candidat)', required: true, minLength: 10 },
        onConfirm: (reason: string) => act(() => disqualifyCandidate(x._id, reason), 'Candidat disqualifié.', 'La disqualification a échoué.')(),
    });

    const footer = canWrite && c ? (() => {
        const canReview = !GONE.includes(c.status);
        const menu = [
            SUSPENDABLE.includes(c.status) && (
                <MenuItem key="s" onSelect={() => askSuspend(c)}><HugeiconsIcon icon={PauseIcon} size={16} aria-hidden="true" />Suspendre</MenuItem>
            ),
            c.status === 'SUSPENDED' && (
                <MenuItem key="r" onSelect={() => askReinstate(c)}><HugeiconsIcon icon={PlayIcon} size={16} aria-hidden="true" />Rétablir</MenuItem>
            ),
            (SUSPENDABLE.includes(c.status) || c.status === 'SUSPENDED') && (
                <MenuItem key="d" destructive onSelect={() => askDisqualify(c)}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />Disqualifier</MenuItem>
            ),
        ].filter(Boolean);
        if (!canReview && menu.length === 0) return undefined;
        return (
            <>
                {menu.length > 0 && <div className="sm:mr-auto"><RowMenu label="Autres actions">{menu}</RowMenu></div>}
                {canReview && c.review.status !== 'CHANGES_REQUESTED' && (
                    <Button variant="outline" size="lg" onClick={() => askChanges(c)}>
                        <HugeiconsIcon icon={Edit02Icon} size={16} aria-hidden="true" />Demander des modifications
                    </Button>
                )}
                {canReview && c.review.status !== 'APPROVED' && (
                    <Button variant="primary" size="lg" onClick={() => askApprove(c)}>
                        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />Valider le profil
                    </Button>
                )}
            </>
        );
    })() : undefined;

    const below = !!c?.seatNumber && c.invitations.valid < c.invitations.required;
    const fields = edition.settings?.profileFields ?? [];
    const extra = c?.profile.extra ?? {};
    const unknownExtra = Object.keys(extra).filter(k => !fields.some(f => f.key === k));

    return (
        <Dialog open onOpenChange={open => { if (!open && !confirm) onClose(); }}>
            <SheetContent
                width="lg"
                title={c ? c.profile.name : 'Candidat'}
                description={c ? c.profile.projectName : undefined}
                footer={footer}
            >
                {details.isLoading ? (
                    <div className="space-y-3" aria-busy="true">
                        <Skeleton className="h-40 w-40" />
                        <Skeleton className="h-32 w-full" />
                        <Skeleton className="h-48 w-full" />
                    </div>
                ) : !c ? (
                    <ErrorState error={new Error(impactErrorMessage(details.error, 'Impossible de charger le candidat.'))} onRetry={() => void details.refetch()} retrying={details.isFetching} />
                ) : (
                    <div className={`space-y-6 ${details.isFetching ? 'opacity-60 transition-opacity' : ''}`}>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                            <CandidatePhoto fileId={c.profile.photoFileId} name={c.profile.name} />
                            <div className="min-w-0 space-y-2">
                                <div className="flex flex-wrap gap-1">
                                    <CandidateStatusBadge status={c.status} />
                                    <ReviewBadge status={c.review.status} />
                                    {below && <BelowRequirementBadge />}
                                </div>
                                <p className="text-sm text-fg-muted">
                                    {c.profile.activity} · {c.profile.city}, {getCountryName(c.profile.country) || c.profile.country}
                                </p>
                                <p className="text-sm text-fg-muted">
                                    <Link to={`/userpage/${c.userId}`} className="text-primary hover:underline">Voir la fiche du membre</Link>
                                </p>
                            </div>
                        </div>

                        {c.review.status === 'CHANGES_REQUESTED' && c.review.reason && (
                            <Notice tone="info">Modifications demandées{c.review.at ? ` (${formatDateTime(c.review.at)})` : ''} : « {c.review.reason} »</Notice>
                        )}
                        {c.status === 'SUSPENDED' && (
                            <Notice tone="warning">Suspendu. « Rétablir » le ramène au statut « {statusWord(c.suspendedFrom ?? '')} ».</Notice>
                        )}
                        {below && (
                            <Notice tone="danger">
                                Il a une place mais n’a plus que {c.invitations.valid} invitation{c.invitations.valid > 1 ? 's' : ''} valide{c.invitations.valid > 1 ? 's' : ''} sur {c.invitations.required} :
                                une activation de filleul a été annulée après l’attribution. La place est gardée ; à vous de décider.
                            </Notice>
                        )}

                        <SheetSection title="Qualification">
                            <DetailList items={[
                                ['Identifiant SBC', c.sbcId ? <span className="font-mono">{c.sbcId}</span> : '—'],
                                ['Invitations valides', `${formatNumber(c.invitations.valid)} / ${formatNumber(c.invitations.required)}`],
                                ['Filleuls inscrits sans pack payé', formatNumber(c.invitations.pending)],
                                c.invitations.reachedAt ? ['Seuil atteint le', formatDateTime(c.invitations.reachedAt)] : null,
                                ['Dernier comptage', c.invitations.checkedAt ? <DateText value={c.invitations.checkedAt} /> : '—'],
                                c.seatNumber ? ['Place', `n° ${c.seatNumber}${c.seatAt ? ` · ${formatDateTime(c.seatAt)}` : ''}`] : null,
                                c.waitlistRank ? ['Liste d’attente', `rang ${c.waitlistRank}`] : null,
                                ['Candidature déposée', formatDateTime(c.createdAt)],
                                ['Profil modifié', formatDateTime(c.profileUpdatedAt)],
                            ]} />
                        </SheetSection>

                        <SheetSection title="Profil">
                            <DetailList items={[
                                ['Nom et prénom', c.profile.name],
                                ['Pays', getCountryName(c.profile.country) || c.profile.country],
                                ['Ville', c.profile.city],
                                ['Activité professionnelle', c.profile.activity],
                                ['Catégorie', c.profile.category],
                                ['Nom du projet', c.profile.projectName],
                                ['Lien', c.profile.link
                                    ? <a href={c.profile.link} target="_blank" rel="noreferrer noopener" className="break-all text-primary hover:underline">{c.profile.link}</a>
                                    : '—'],
                                ...fields.map(f => [f.label, extra[f.key] || '—'] as [ReactNode, ReactNode]),
                                ...unknownExtra.map(k => [`${k} (question retirée)`, extra[k]] as [ReactNode, ReactNode]),
                            ]} />
                            <p className="pt-2 text-xs font-medium text-fg-muted">Description du projet</p>
                            <Paragraph>{c.profile.projectDescription}</Paragraph>
                            <p className="pt-2 text-xs font-medium text-fg-muted">Présentation du projet</p>
                            <Paragraph>{c.profile.presentation}</Paragraph>
                        </SheetSection>

                        <SheetSection title="Historique du statut">
                            {c.statusHistory.length === 0 ? (
                                <p className="text-sm text-fg-muted">Aucun changement de statut.</p>
                            ) : (
                                <ul className="divide-y divide-line rounded-panel border border-line">
                                    {[...c.statusHistory].reverse().map((h, i) => (
                                        <li key={i} className="space-y-0.5 px-4 py-2.5 text-sm">
                                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                                <span className="text-fg">{statusWord(h.from)} → <b className="font-medium">{statusWord(h.to)}</b></span>
                                                <DateText value={h.at} className="text-xs text-fg-muted" />
                                            </div>
                                            {h.reason && <p className="text-xs text-fg">« {h.reason} »</p>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </SheetSection>

                        <SheetSection title="Journal du candidat">
                            <AuditList items={details.data?.audit ?? []} />
                        </SheetSection>
                    </div>
                )}
            </SheetContent>
            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </Dialog>
    );
}
