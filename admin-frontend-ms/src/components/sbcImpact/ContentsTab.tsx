import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Video01Icon } from '@hugeicons/core-free-icons';
import { Badge, Button, EmptyState, Field, Input, Panel, PanelHeader, Skeleton } from '../ui';
import {
    ConfirmDialog, DateText, ErrorState, FilterBar, FilterSelect, Notice, formatNumber, plural, type ConfirmOptions,
} from '../moduleKit';
import ReviewVideoPlayer from '../common/ReviewVideoPlayer';
import { getFileUrl } from '../../utils/fileUtils';
import {
    PROJECT_HEADINGS, SUBMISSION_KIND_LABELS, SUBMISSION_STATUS_LABELS, impactErrorMessage, listSubmissions, readImpactError,
    reviewSubmission, setSubmissionExternalUrl,
    type SubmissionKind, type SubmissionRow, type SubmissionStatus,
} from '../../services/impactV2Api';
import { CandidateThumb, SubmissionStatusBadge } from './shared';

/** Where SBC published an accepted content (Facebook post…), https or empty to remove. */
function ExternalLink({ s, canWrite, onSaved }: { s: SubmissionRow; canWrite: boolean; onSaved: () => void }) {
    const [value, setValue] = useState(s.externalUrl ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { setValue(s.externalUrl ?? ''); }, [s.externalUrl]);
    const dirty = value.trim() !== (s.externalUrl ?? '');

    const save = async () => {
        const v = value.trim();
        if (v && !/^https:\/\/\S+$/i.test(v)) { setError('Le lien doit être une adresse https complète.'); return; }
        setSaving(true);
        setError(null);
        try {
            await setSubmissionExternalUrl(s._id, v);
            toast.success(v ? 'Lien de publication enregistré.' : 'Lien de publication retiré.');
            onSaved();
        } catch (err) {
            setError(impactErrorMessage(err, 'Le lien n’a pas pu être enregistré.'));
        } finally {
            setSaving(false);
        }
    };

    if (!canWrite) {
        return s.externalUrl
            ? <p className="text-sm">Publié sur : <a href={s.externalUrl} target="_blank" rel="noreferrer noopener" className="break-all text-primary hover:underline">{s.externalUrl}</a></p>
            : null;
    }
    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Lien de la publication (Facebook…)" error={error ?? undefined} className="min-w-0 flex-1" help="Affiché sur la page du candidat. Vide pour le retirer.">
                <Input type="url" inputMode="url" placeholder="https://www.facebook.com/…" className="h-11 sm:h-9" value={value} onChange={e => setValue(e.target.value)} />
            </Field>
            <Button variant="outline" size="lg" className="sm:mb-5" onClick={() => void save()} loading={saving} disabled={!dirty}>Enregistrer le lien</Button>
        </div>
    );
}

function SubmissionCard({ s, canWrite, ask, onChanged }: {
    s: SubmissionRow;
    canWrite: boolean;
    ask: (o: ConfirmOptions) => void;
    onChanged: () => void;
}) {
    const name = s.candidate?.name ?? 'Candidat';
    const what = s.kind === 'VIDEO' ? 'la vidéo' : 'la présentation du projet';

    /** Sends the decision on the version displayed; a content replaced meanwhile (STALE) reloads the queue. */
    const decide = (decision: 'accept' | 'reject' | 'resubmit', success: string) => async (reason: string) => {
        try {
            await reviewSubmission(s._id, { decision, ...(decision === 'accept' ? {} : { reason }), updatedAt: s.updatedAt });
            toast.success(success);
        } catch (err) {
            const x = readImpactError(err, 'La décision n’a pas pu être enregistrée.');
            if (x.code === 'STALE' || x.code === 'ALREADY_REVIEWED') {
                toast.error(x.message);
                onChanged();
                return;
            }
            throw new Error(x.message);
        }
        onChanged();
    };

    const askAccept = () => ask({
        title: `Valider ${what} de ${name} ?`,
        tone: 'primary',
        confirmLabel: 'Valider et publier',
        description: `Elle est publiée tout de suite sur la page du candidat${s.kind === 'VIDEO' ? ' et soumise au vote gratuit' : ' et soumise aux votes payants'}. Le candidat est prévenu.`,
        onConfirm: decide('accept', 'Contenu validé et publié.'),
    });
    const askResubmit = () => ask({
        title: 'Demander une nouvelle version ?',
        tone: 'primary',
        confirmLabel: 'Envoyer la demande',
        description: 'Le candidat lit votre message et dépose une nouvelle version.',
        reason: { label: 'Ce qu’il faut changer (lu par le candidat)', required: true, minLength: 10 },
        onConfirm: decide('resubmit', 'Nouvelle version demandée au candidat.'),
    });
    const askReject = () => ask({
        title: `Refuser ${what} de ${name} ?`,
        confirmLabel: 'Refuser',
        description: 'C’est définitif pour ce contenu : le candidat ne pourra pas en déposer un autre. Pour une correction, demandez plutôt une nouvelle version.',
        reason: { label: 'Raison (lue par le candidat)', required: true, minLength: 10 },
        onConfirm: decide('reject', 'Contenu refusé.'),
    });

    const videoId = s.kind === 'VIDEO' ? s.video?.videoFileId : s.project?.videoFileId;

    return (
        <Panel className="space-y-4 p-4 sm:p-5" data-testid={`submission-${s._id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                    <CandidateThumb fileId={s.candidate?.photoFileId} name={name} />
                    <div className="min-w-0">
                        <p className="truncate font-medium text-fg">{name}{s.candidate?.seatNumber ? <span className="text-fg-muted"> · n° {s.candidate.seatNumber}</span> : null}</p>
                        <p className="truncate text-xs text-fg-muted">{s.candidate?.projectName}</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                    <Badge tone="outline">{SUBMISSION_KIND_LABELS[s.kind]}</Badge>
                    {s.version > 1 && <Badge tone="neutral">Version {s.version}</Badge>}
                    <SubmissionStatusBadge status={s.status} />
                </div>
            </div>
            <p className="text-xs text-fg-muted">Déposé <DateText value={s.updatedAt} />{s.publishedAt ? <> · publié <DateText value={s.publishedAt} /></> : null}</p>

            {videoId && <ReviewVideoPlayer src={getFileUrl(videoId)} />}
            {s.kind === 'VIDEO' && s.video?.caption && <p className="whitespace-pre-line text-sm text-fg">{s.video.caption}</p>}
            {s.kind === 'PROJECT' && s.project && (
                <dl className="divide-y divide-line rounded-panel border border-line">
                    {PROJECT_HEADINGS.map(([key, label]) => (
                        <div key={key} className="space-y-1 px-4 py-3">
                            <dt className="text-xs font-semibold text-fg-muted">{label}</dt>
                            <dd className="whitespace-pre-line text-sm text-fg">{s.project?.[key] || '—'}</dd>
                        </div>
                    ))}
                </dl>
            )}

            {s.review?.reason && (s.status === 'REJECTED' || s.status === 'RESUBMIT_REQUESTED') && (
                <Notice tone={s.status === 'REJECTED' ? 'danger' : 'info'}>Message au candidat : « {s.review.reason} »</Notice>
            )}

            {s.status === 'ACCEPTED' && <ExternalLink s={s} canWrite={canWrite} onSaved={onChanged} />}

            {canWrite && s.status === 'PENDING' && (
                <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
                    <Button variant="danger-ghost" size="lg" onClick={askReject}>Refuser</Button>
                    <Button variant="outline" size="lg" onClick={askResubmit}>Demander une nouvelle version</Button>
                    <Button variant="primary" size="lg" onClick={askAccept}>Valider et publier</Button>
                </div>
            )}
        </Panel>
    );
}

/** The candidates' week-2 videos and week-3 projects: validate, refuse, ask for a new version, link the publication. */
export default function ContentsTab({ editionId, canWrite, onChanged }: { editionId: string; canWrite: boolean; onChanged: () => void }) {
    const [kind, setKind] = useState<SubmissionKind | ''>('');
    const [status, setStatus] = useState<SubmissionStatus | ''>('');
    const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
    const list = useQuery({
        queryKey: ['sbc-impact', 'submissions', editionId, { kind, status }],
        queryFn: () => listSubmissions(editionId, { kind, status }),
    });
    // Server order: pending first (oldest first), then new version requested, accepted, refused.
    const rows = list.data ?? [];
    const pending = rows.filter(r => r.status === 'PENDING').length;
    const reload = () => { void list.refetch(); onChanged(); };
    const active = (kind ? 1 : 0) + (status ? 1 : 0);

    return (
        <div className="space-y-4">
            <Panel>
                <PanelHeader
                    title="Contenus des candidats"
                    description={list.data
                        ? `${formatNumber(rows.length)} ${plural(rows.length, 'contenu')}${pending ? ` · ${formatNumber(pending)} à valider` : ''}. Les contenus à valider viennent en premier.`
                        : 'Vidéos de la semaine 2 et projets de la semaine 3.'}
                />
                <div className="px-4 pb-4 sm:px-5">
                    <FilterBar
                        filterCount={2}
                        activeCount={active}
                        onClear={() => { setKind(''); setStatus(''); }}
                        filters={(
                            <>
                                <FilterSelect label="Type" allLabel="Tous les contenus" value={kind} onChange={v => setKind(v as SubmissionKind | '')}
                                    options={(Object.keys(SUBMISSION_KIND_LABELS) as SubmissionKind[]).map(k => ({ value: k, label: SUBMISSION_KIND_LABELS[k] }))} />
                                <FilterSelect label="État" allLabel="Tous les états" value={status} onChange={v => setStatus(v as SubmissionStatus | '')}
                                    options={(Object.keys(SUBMISSION_STATUS_LABELS) as SubmissionStatus[]).map(k => ({ value: k, label: SUBMISSION_STATUS_LABELS[k] }))} />
                            </>
                        )}
                    />
                </div>
            </Panel>

            {list.isLoading ? (
                <div className="space-y-3" aria-busy="true">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-64 w-full" />)}</div>
            ) : list.isError ? (
                <Panel><ErrorState error={new Error(impactErrorMessage(list.error, 'Impossible de charger les contenus.'))} onRetry={() => void list.refetch()} retrying={list.isFetching} /></Panel>
            ) : rows.length === 0 ? (
                <Panel>
                    <EmptyState
                        icon={Video01Icon}
                        title={active ? 'Aucun contenu avec ces filtres' : 'Aucun contenu déposé pour l’instant'}
                        description={active ? undefined : 'Les candidats déposent leur vidéo en semaine 2 et leur projet en semaine 3.'}
                    />
                </Panel>
            ) : (
                <div className={`space-y-4 ${list.isFetching ? 'opacity-60 transition-opacity' : ''}`}>
                    {list.data && list.data.length >= 500 && (
                        <Notice tone="warning">Seuls les 500 premiers contenus sont affichés : filtrez par type ou par état.</Notice>
                    )}
                    {rows.map(s => <SubmissionCard key={s._id} s={s} canWrite={canWrite} ask={setConfirm} onChanged={reload} />)}
                </div>
            )}

            <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
