import { useEffect, useRef, useState } from 'react';
import { Dialog as D } from 'radix-ui';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, Delete02Icon, FavouriteIcon, Location01Icon, ViewIcon } from '@hugeicons/core-free-icons';
import { getAvatarUrl } from '../../api/apiClient';
import type { Status } from '../../services/statusApi';
import { cn } from '../../lib/cn';
import { Can } from '../Can';
import { Avatar } from '../ui';
import { fmtInt, fmtRelative } from '../display/format';
import type { StatusGroup } from './status-utils';

const STORY_MS = 5000;
const TICK_MS = 50;

/**
 * Full-screen story player, as members see it: 5 s per story, author after
 * author; tap the sides (or the arrow keys) to go back or forward. Each story
 * shown is marked as viewed, like before.
 */
export function StoryViewer({ groups, start, paused = false, onClose, onView, onLike, onDelete, canDelete }: {
    groups: StatusGroup[];
    /** Author and story to start from; null = closed. */
    start: { authorId: string; index: number } | null;
    /** Holds the timer (a confirmation is open over the story). */
    paused?: boolean;
    onClose: () => void;
    onView: (statusId: string) => void;
    onLike: (status: Status) => void;
    onDelete: (status: Status) => void;
    canDelete: (status: Status) => boolean;
}) {
    const [pos, setPos] = useState<{ authorId: string; index: number } | null>(start);
    const [progress, setProgress] = useState(0);
    useEffect(() => { setPos(start); setProgress(0); }, [start]);

    const groupIndex = pos ? groups.findIndex(g => g.authorId === pos.authorId) : -1;
    const group = groupIndex >= 0 ? groups[groupIndex] : null;
    // A deleted story leaves the next one at the same place.
    const index = group && pos ? Math.min(pos.index, group.statuses.length - 1) : 0;
    const story = group?.statuses[index];

    const next = () => {
        if (!group) return;
        if (index < group.statuses.length - 1) setPos({ authorId: group.authorId, index: index + 1 });
        else if (groupIndex < groups.length - 1) setPos({ authorId: groups[groupIndex + 1].authorId, index: 0 });
        else onClose();
        setProgress(0);
    };
    const prev = () => {
        if (!group) return;
        if (index > 0) setPos({ authorId: group.authorId, index: index - 1 });
        else if (groupIndex > 0) {
            const g = groups[groupIndex - 1];
            setPos({ authorId: g.authorId, index: g.statuses.length - 1 });
        }
        setProgress(0);
    };
    const nextRef = useRef(next);
    nextRef.current = next;

    // The open author left the list (all their stories deleted): close.
    useEffect(() => { if (pos && !group) onClose(); }, [pos, group, onClose]);

    // Mark each story shown as viewed
    const storyId = story?._id;
    useEffect(() => { if (storyId) onView(storyId); }, [storyId, onView]);

    // 5 s per story
    useEffect(() => {
        if (!storyId || paused) return;
        const timer = setInterval(() => {
            setProgress(p => Math.min(100, p + (TICK_MS / STORY_MS) * 100));
        }, TICK_MS);
        return () => clearInterval(timer);
    }, [storyId, paused]);
    useEffect(() => { setProgress(0); }, [storyId]);
    // Story finished: go on to the next one
    useEffect(() => { if (progress >= 100) nextRef.current(); }, [progress]);

    return (
        <D.Root open={!!pos && !!story} onOpenChange={o => { if (!o) onClose(); }}>
            <D.Portal>
                <D.Overlay className="fixed inset-0 z-[200] bg-black" />
                <D.Content
                    className="fixed inset-0 z-[201] flex items-center justify-center focus:outline-none"
                    onKeyDown={e => {
                        if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
                        if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
                    }}
                >
                    {group && story && (
                        <div className="relative flex h-full w-full max-w-md flex-col bg-[oklch(0.18_0.01_258)] text-white">
                            <D.Title className="sr-only">Story de {group.authorName}</D.Title>
                            <D.Description className="sr-only">Story {index + 1} sur {group.statuses.length}. Flèches gauche et droite pour naviguer.</D.Description>

                            <div className="absolute inset-x-0 top-0 z-20 flex gap-1 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]" aria-hidden="true">
                                {group.statuses.map((s, i) => (
                                    <div key={s._id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
                                        <div className="h-full bg-white" style={{ width: i < index ? '100%' : i === index ? `${progress}%` : '0%' }} />
                                    </div>
                                ))}
                            </div>

                            <div className="absolute inset-x-0 top-4 z-20 flex items-center justify-between px-3 pt-[env(safe-area-inset-top)]">
                                <div className="flex min-w-0 items-center gap-2">
                                    <Avatar src={getAvatarUrl(group.authorAvatar)} name={group.authorName} size="sm" />
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium">{group.authorName}</p>
                                        <p className="text-xs text-white/70">{fmtRelative(story.createdAt)}</p>
                                    </div>
                                </div>
                                <D.Close className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="Fermer">
                                    <HugeiconsIcon icon={Cancel01Icon} size={22} aria-hidden="true" />
                                </D.Close>
                            </div>

                            <div className="relative flex flex-1 items-center justify-center overflow-hidden">
                                <button type="button" onClick={prev} aria-label="Story précédente" className="absolute inset-y-0 left-0 z-10 w-1/3">
                                    {(index > 0 || groupIndex > 0) && <HugeiconsIcon icon={ArrowLeft01Icon} size={28} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />}
                                </button>
                                <button type="button" onClick={next} aria-label="Story suivante" className="absolute inset-y-0 right-0 z-10 w-1/3">
                                    <HugeiconsIcon icon={ArrowRight01Icon} size={28} aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50" />
                                </button>

                                {story.mediaUrl ? (
                                    story.mediaType === 'video'
                                        ? <video key={story._id} src={story.mediaUrl} className="h-full w-full object-contain" autoPlay muted playsInline />
                                        : <img src={story.mediaUrl} alt={story.content || 'Story'} className="h-full w-full object-contain" />
                                ) : (
                                    <div className="p-8 text-center">
                                        <p className="whitespace-pre-wrap break-words text-xl leading-relaxed">{story.content}</p>
                                        {story.country && (
                                            <p className="mt-4 flex items-center justify-center gap-1 text-sm text-white/70">
                                                <HugeiconsIcon icon={Location01Icon} size={16} aria-hidden="true" />{story.city || story.country}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {story.mediaUrl && (story.content || story.country) && (
                                    <div className="absolute inset-x-0 bottom-20 px-4">
                                        <div className="rounded-panel bg-black/60 p-3">
                                            {story.content && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{story.content}</p>}
                                            {story.country && (
                                                <p className="mt-1 flex items-center gap-1 text-xs text-white/70">
                                                    <HugeiconsIcon icon={Location01Icon} size={12} aria-hidden="true" />{story.city || story.country}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                                <Can
                                    module="communication"
                                    write
                                    fallback={(
                                        <span className="flex h-11 items-center gap-2 px-2 text-sm tabular-nums">
                                            <HugeiconsIcon icon={FavouriteIcon} size={20} aria-hidden="true" />{fmtInt(story.likesCount)}
                                        </span>
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => onLike(story)}
                                        aria-pressed={!!story.isLiked}
                                        aria-label={story.isLiked ? 'Je n’aime plus' : 'J’aime'}
                                        className={cn('flex h-11 items-center gap-2 rounded-full px-3 text-sm tabular-nums hover:bg-white/10', story.isLiked && 'text-[#ff6b81]')}
                                    >
                                        <HugeiconsIcon icon={FavouriteIcon} size={22} aria-hidden="true" />{fmtInt(story.likesCount)}
                                    </button>
                                </Can>
                                <span className="flex h-11 items-center gap-2 px-2 text-sm tabular-nums" aria-label={`${story.viewsCount} vues`}>
                                    <HugeiconsIcon icon={ViewIcon} size={20} aria-hidden="true" />{fmtInt(story.viewsCount)}
                                </span>
                                <span className="flex-1" />
                                {canDelete(story) && (
                                    <Can module="communication" write>
                                        <button
                                            type="button"
                                            onClick={() => onDelete(story)}
                                            aria-label="Supprimer la story"
                                            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 hover:text-[#ff8a8a]"
                                        >
                                            <HugeiconsIcon icon={Delete02Icon} size={20} aria-hidden="true" />
                                        </button>
                                    </Can>
                                )}
                            </div>
                        </div>
                    )}
                </D.Content>
            </D.Portal>
        </D.Root>
    );
}
