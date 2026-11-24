import { toast } from 'sonner';
import { Badge, Button } from '../ui';
import { DateText, Notice, type ConfirmOptions } from '../moduleKit';
import {
    SHOWCASE_KIND_LABELS, impactErrorMessage, photoUrl, reviewShowcaseUpdate, type ShowcaseUpdate,
} from '../../services/impactV2Api';
import { ShowcaseUpdateStatusBadge } from './shared';

/**
 * One piece of news of a SBC Impact page, with what can be done to it:
 * a finalist's pending news is approved or rejected (the finalist reads the
 * reason), a published one can be removed.
 */
export default function ShowcaseUpdateCard({ u, finalist, canWrite, ask, onChanged }: {
    u: ShowcaseUpdate;
    /** Shown in the queue (several pages at once). */
    finalist?: { name: string; projectName: string } | null;
    canWrite: boolean;
    ask: (o: ConfirmOptions) => void;
    onChanged: () => void;
}) {
    const decide = (decision: 'approve' | 'reject' | 'remove', success: string) => async (reason: string) => {
        try {
            await reviewShowcaseUpdate(u._id, decision, decision === 'approve' ? undefined : reason);
            toast.success(success);
        } catch (err) {
            throw new Error(impactErrorMessage(err, 'La décision n’a pas pu être enregistrée.'));
        } finally {
            onChanged();
        }
    };
    const askApprove = () => ask({
        title: `Publier « ${u.title} » ?`,
        tone: 'primary',
        confirmLabel: 'Publier',
        description: 'La nouvelle apparaît tout de suite sur la page SBC Impact, et le finaliste est prévenu.',
        onConfirm: decide('approve', 'Nouvelle publiée.'),
    });
    const askReject = () => ask({
        title: `Refuser « ${u.title} » ?`,
        confirmLabel: 'Refuser',
        description: 'La nouvelle n’est pas publiée. Le finaliste est prévenu et lit votre raison.',
        reason: { label: 'Raison (lue par le finaliste)', required: true, minLength: 10 },
        onConfirm: decide('reject', 'Nouvelle refusée.'),
    });
    const askRemove = () => ask({
        title: `Retirer « ${u.title} » ?`,
        confirmLabel: 'Retirer',
        description: 'La nouvelle disparaît de la page SBC Impact.',
        reason: { label: 'Raison', required: true, minLength: 5 },
        onConfirm: decide('remove', 'Nouvelle retirée.'),
    });

    return (
        <article className="space-y-2 rounded-panel border border-line p-4" data-testid={`update-${u._id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    {finalist && <p className="text-xs text-fg-muted">{finalist.name} · {finalist.projectName}</p>}
                    <h3 className="font-medium text-fg">{u.title}</h3>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                    <Badge tone="outline">{SHOWCASE_KIND_LABELS[u.kind] ?? u.kind}</Badge>
                    <ShowcaseUpdateStatusBadge status={u.status} />
                </div>
            </div>
            <p className="text-xs text-fg-muted">
                {u.authorRole === 'admin' ? 'Par l’administration' : 'Proposée par le finaliste'} · <DateText value={u.createdAt} />
                {u.publishedAt && <> · publiée <DateText value={u.publishedAt} /></>}
            </p>
            <p className="whitespace-pre-line text-sm text-fg">{u.body}</p>
            {u.imageFileId && (
                <a href={photoUrl(u.imageFileId)} target="_blank" rel="noreferrer noopener" className="inline-block">
                    <img src={photoUrl(u.imageFileId, 480)} alt="" className="max-h-48 rounded-panel border border-line object-cover" />
                </a>
            )}
            {u.link && <a href={u.link} target="_blank" rel="noreferrer noopener" className="block break-all text-sm text-primary hover:underline">{u.link}</a>}
            {u.review?.reason && (u.status === 'REJECTED' || u.status === 'REMOVED') && (
                <Notice tone={u.status === 'REJECTED' ? 'danger' : 'info'}>« {u.review.reason} »</Notice>
            )}
            {canWrite && (u.status === 'PENDING' || u.status === 'PUBLISHED') && (
                <div className="flex flex-wrap justify-end gap-2 pt-1">
                    {u.status === 'PENDING' && (
                        <>
                            <Button variant="danger-ghost" size="sm" className="h-11 sm:h-8" onClick={askReject}>Refuser</Button>
                            <Button variant="primary" size="sm" className="h-11 sm:h-8" onClick={askApprove}>Publier</Button>
                        </>
                    )}
                    {u.status === 'PUBLISHED' && <Button variant="danger-ghost" size="sm" className="h-11 sm:h-8" onClick={askRemove}>Retirer</Button>}
                </div>
            )}
        </article>
    );
}
