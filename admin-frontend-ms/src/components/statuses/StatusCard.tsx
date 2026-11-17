import { HugeiconsIcon } from '@hugeicons/react';
import { FavouriteIcon, PlayIcon, ViewIcon } from '@hugeicons/core-free-icons';
import { getAvatarUrl } from '../../api/apiClient';
import type { Status } from '../../services/statusApi';
import { Avatar, Badge, Tooltip } from '../ui';
import { fmtCompact, fmtDateTime, fmtRelative } from '../display/format';

/** A story in the grid: its picture (or text), author, category, age and reach. Opens the details. */
export function StatusCard({ status, category, onOpen }: { status: Status; category: string; onOpen: () => void }) {
    const thumb = status.mediaThumbnailUrl || (status.mediaType !== 'video' ? status.mediaUrl : undefined);
    const author = status.author?.name || 'Membre';
    return (
        <button
            type="button"
            onClick={onOpen}
            className="group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-panel border border-line bg-surface text-left transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-label={`Story de ${author}, ${category}, ${fmtRelative(status.createdAt)}`}
        >
            <div className="relative aspect-[4/5] w-full overflow-hidden bg-surface-2">
                {thumb ? (
                    <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : status.mediaType === 'video' && status.mediaUrl ? (
                    <video src={status.mediaUrl} preload="metadata" muted playsInline className="h-full w-full object-cover" aria-hidden="true" />
                ) : (
                    <p className="line-clamp-[8] h-full overflow-hidden whitespace-pre-wrap break-words p-3 text-sm leading-relaxed text-fg">
                        {status.content}
                    </p>
                )}
                {status.mediaType === 'video' && (
                    <span className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[oklch(0.15_0.02_258/0.6)] text-white" aria-hidden="true">
                        <HugeiconsIcon icon={PlayIcon} size={14} />
                    </span>
                )}
            </div>
            <div className="min-w-0 space-y-1.5 p-3">
                <div className="flex min-w-0 items-center gap-2">
                    <Avatar src={getAvatarUrl(status.author?.avatar)} name={author} size="xs" />
                    <span className="truncate text-sm font-medium text-fg">{author}</span>
                </div>
                {status.mediaType !== 'text' && status.content && (
                    <p className="line-clamp-2 break-words text-xs text-fg-muted">{status.content}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone="neutral" className="max-w-full truncate">{category}</Badge>
                    <Tooltip content={fmtDateTime(status.createdAt)}>
                        <span className="text-xs text-fg-subtle">{fmtRelative(status.createdAt)}</span>
                    </Tooltip>
                </div>
                <div className="flex items-center gap-3 text-xs text-fg-muted tabular-nums">
                    <span className="flex items-center gap-1" aria-label={`${status.viewsCount} vues`}>
                        <HugeiconsIcon icon={ViewIcon} size={14} aria-hidden="true" /> {fmtCompact(status.viewsCount ?? 0)}
                    </span>
                    <span className="flex items-center gap-1" aria-label={`${status.likesCount} j’aime`}>
                        <HugeiconsIcon icon={FavouriteIcon} size={14} aria-hidden="true" /> {fmtCompact(status.likesCount ?? 0)}
                    </span>
                </div>
            </div>
        </button>
    );
}
