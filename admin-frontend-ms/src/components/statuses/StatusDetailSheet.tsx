import type { ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, ArrowRight01Icon, Delete02Icon, FavouriteIcon, PlayCircleIcon } from '@hugeicons/core-free-icons';
import { getAvatarUrl } from '../../api/apiClient';
import type { Status } from '../../services/statusApi';
import { Can } from '../Can';
import { Avatar, Badge, Button, Dialog, SheetContent } from '../ui';
import { RelativeDate } from '../display/RelativeDate';
import { fmtInt } from '../display/format';
import { MEDIA_LABEL, placeOf } from './status-utils';

function Item({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
            <dt className="shrink-0 text-fg-muted">{label}</dt>
            <dd className="min-w-0 text-right text-fg">{children}</dd>
        </div>
    );
}

/** One story in full, with what the admin can do about it. */
export function StatusDetailSheet({
    status, category, position, total, canDelete, liking,
    onClose, onPrev, onNext, onLike, onDelete, onPlay, onShowAuthor,
}: {
    status: Status | null;
    category: string;
    position: number;
    total: number;
    /** Deleting a member's story is for the super admin (the chat service checks the role). */
    canDelete: boolean;
    liking: boolean;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
    onLike: () => void;
    onDelete: () => void;
    onPlay: () => void;
    onShowAuthor: (userId: string) => void;
}) {
    return (
        <Dialog open={!!status} onOpenChange={open => { if (!open) onClose(); }}>
            {status && (
                <SheetContent
                    width="lg"
                    title={`Story de ${status.author?.name || 'membre'}`}
                    description={`${category} · ${MEDIA_LABEL[status.mediaType] ?? status.mediaType}`}
                    footer={(
                        <Can module="communication" write>
                            {canDelete ? (
                                <Button variant="danger-ghost" size="lg" onClick={onDelete} className="sm:mr-auto">
                                    <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" /> Supprimer la story
                                </Button>
                            ) : (
                                <p className="text-xs text-fg-muted sm:mr-auto sm:self-center">Seul un super administrateur peut supprimer la story d’un membre.</p>
                            )}
                            <Button variant={status.isLiked ? 'soft' : 'outline'} size="lg" onClick={onLike} loading={liking} aria-pressed={!!status.isLiked}>
                                {!liking && <HugeiconsIcon icon={FavouriteIcon} size={16} aria-hidden="true" />}
                                {status.isLiked ? 'Vous aimez' : 'J’aime'}
                            </Button>
                        </Can>
                    )}
                >
                    <div className="space-y-5">
                        <div className="flex items-center justify-between gap-2">
                            <Button variant="outline" size="lg" className="px-3" onClick={onPrev} disabled={position <= 0} aria-label="Story précédente">
                                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" />
                                <span className="hidden sm:inline">Précédente</span>
                            </Button>
                            <span className="text-xs text-fg-muted tabular-nums">{position + 1} / {total}</span>
                            <Button variant="outline" size="lg" className="px-3" onClick={onNext} disabled={position >= total - 1} aria-label="Story suivante">
                                <span className="hidden sm:inline">Suivante</span>
                                <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
                            </Button>
                        </div>

                        {status.mediaUrl ? (
                            <div className="overflow-hidden rounded-panel border border-line bg-[oklch(0.15_0.02_258)]">
                                {status.mediaType === 'video' ? (
                                    <video key={status._id} src={status.mediaUrl} controls playsInline className="max-h-[45dvh] w-full object-contain" />
                                ) : (
                                    <img src={status.mediaUrl} alt={status.content || 'Story'} className="max-h-[45dvh] w-full object-contain" />
                                )}
                            </div>
                        ) : null}

                        {status.content && (
                            <p className="whitespace-pre-wrap break-words rounded-panel bg-surface-2 p-4 text-sm leading-relaxed text-fg">{status.content}</p>
                        )}

                        <Button variant="outline" size="lg" className="w-full" onClick={onPlay}>
                            <HugeiconsIcon icon={PlayCircleIcon} size={16} aria-hidden="true" /> Lire en mode story
                        </Button>

                        <button
                            type="button"
                            onClick={() => status.author && onShowAuthor(status.author._id)}
                            className="flex w-full items-center gap-3 rounded-control border border-line p-3 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary"
                        >
                            <Avatar src={getAvatarUrl(status.author?.avatar)} name={status.author?.name || '?'} size="md" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-fg">{status.author?.name || 'Membre'}</span>
                                <span className="block text-xs text-fg-muted">Voir le profil</span>
                            </span>
                            <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" className="text-fg-subtle" />
                        </button>

                        <dl className="divide-y divide-line">
                            <Item label="Catégorie"><Badge>{category}</Badge></Item>
                            <Item label="Publiée"><RelativeDate value={status.createdAt} /></Item>
                            <Item label="Expire"><RelativeDate value={status.expiresAt} /></Item>
                            {placeOf(status) && <Item label="Lieu">{placeOf(status)}</Item>}
                            <Item label="Vues"><span className="tabular-nums">{fmtInt(status.viewsCount)}</span></Item>
                            <Item label="J’aime"><span className="tabular-nums">{fmtInt(status.likesCount)}</span></Item>
                            <Item label="Partages"><span className="tabular-nums">{fmtInt(status.repostsCount)}</span></Item>
                            <Item label="Réponses"><span className="tabular-nums">{fmtInt(status.repliesCount)}</span></Item>
                        </dl>
                    </div>
                </SheetContent>
            )}
        </Dialog>
    );
}
