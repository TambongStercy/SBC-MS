import type { KeyboardEvent } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, CheckListIcon, Delete02Icon, MessageMultiple01Icon, MoreHorizontalIcon, Search01Icon, UserIcon } from '@hugeicons/core-free-icons';
import { getAvatarUrl } from '../../api/apiClient';
import { cn } from '../../lib/cn';
import { Can } from '../Can';
import { Avatar, Badge, Button, Checkbox, EmptyState, Input, Menu, MenuContent, MenuItem, MenuTrigger, Segmented, Skeleton, Tooltip } from '../ui';
import { ErrorState } from '../display/ErrorState';
import { fmtDateTime } from '../display/format';
import { formatChatTime, isPendingConversation, otherParticipant, type DisplayConversation } from './chat-utils';
import { useLongPress } from './useLongPress';

export type ConversationView = 'toutes' | 'non-lues';

interface RowProps {
    conversation: DisplayConversation;
    currentUserId: string;
    online: boolean;
    selected: boolean;
    selectMode: boolean;
    checked: boolean;
    onOpen: () => void;
    onToggle: () => void;
    onStartSelect: () => void;
    onShowMember: (userId: string) => void;
    onDelete: () => void;
}

function ConversationRow({ conversation, currentUserId, online, selected, selectMode, checked, onOpen, onToggle, onStartSelect, onShowMember, onDelete }: RowProps) {
    const pending = isPendingConversation(conversation);
    const other = otherParticipant(conversation, currentUserId);
    const memberId = pending ? conversation.pendingUser._id : other._id;
    const press = () => (selectMode ? (!pending && onToggle()) : onOpen());
    const longPress = useLongPress(() => { if (!selectMode && !pending) onStartSelect(); }, press);
    const onKey = (e: KeyboardEvent) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); press(); }
    };
    const unread = conversation.unreadCount > 0;

    return (
        <li
            role="button"
            tabIndex={0}
            aria-current={selected ? 'true' : undefined}
            aria-label={`Conversation avec ${other.name}${unread ? `, ${conversation.unreadCount} non lu${conversation.unreadCount > 1 ? 's' : ''}` : ''}`}
            onKeyDown={onKey}
            {...longPress}
            className={cn(
                'group relative flex min-h-[72px] cursor-pointer select-none items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
                selected && 'bg-surface-2 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary',
                checked && 'bg-surface-2',
            )}
        >
            {selectMode && (
                <Checkbox
                    checked={checked}
                    disabled={pending}
                    onCheckedChange={() => onToggle()}
                    aria-label={`Sélectionner la conversation avec ${other.name}`}
                    className="h-5 w-5"
                />
            )}
            <Tooltip content="Voir le profil">
                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onShowMember(memberId); }}
                    className="relative shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    aria-label={`Profil de ${other.name}`}
                >
                    <Avatar src={getAvatarUrl(other.avatar)} name={other.name || '?'} size="md" className="h-11 w-11" />
                    {online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface bg-success" aria-label="En ligne" />}
                </button>
            </Tooltip>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                    <span className={cn('truncate text-sm text-fg', unread ? 'font-semibold' : 'font-medium')}>
                        {other.name}
                    </span>
                    {conversation.lastMessageAt && (
                        <Tooltip content={fmtDateTime(conversation.lastMessageAt)}>
                            <span className={cn('shrink-0 text-xs tabular-nums', unread ? 'font-medium text-primary' : 'text-fg-subtle')}>
                                {formatChatTime(conversation.lastMessageAt)}
                            </span>
                        </Tooltip>
                    )}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className={cn('truncate text-sm', unread ? 'text-fg' : 'text-fg-muted')}>
                        {pending ? 'Brouillon : écrivez le premier message' : (conversation.lastMessage?.content || 'Aucun message')}
                    </p>
                    {pending ? <Badge tone="outline">Brouillon</Badge> : unread && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-fg tabular-nums">
                            {conversation.unreadCount}
                        </span>
                    )}
                </div>
            </div>
            {!selectMode && !pending && (
                <Can module="communication" write>
                    <Menu>
                        <MenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-11 w-11 shrink-0 md:h-9 md:w-9 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
                                aria-label={`Actions sur la conversation avec ${other.name}`}
                                onClick={e => e.stopPropagation()}
                            >
                                <HugeiconsIcon icon={MoreHorizontalIcon} size={18} aria-hidden="true" />
                            </Button>
                        </MenuTrigger>
                        <MenuContent onClick={e => e.stopPropagation()}>
                            <MenuItem onSelect={() => onShowMember(memberId)}>
                                <HugeiconsIcon icon={UserIcon} size={16} aria-hidden="true" /> Voir le profil
                            </MenuItem>
                            <MenuItem onSelect={onStartSelect}>
                                <HugeiconsIcon icon={CheckListIcon} size={16} aria-hidden="true" /> Sélectionner
                            </MenuItem>
                            <MenuItem destructive onSelect={onDelete}>
                                <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" /> Supprimer la conversation
                            </MenuItem>
                        </MenuContent>
                    </Menu>
                </Can>
            )}
        </li>
    );
}

/** Left pane: search, "Non lues" view, multi-select and the list itself. */
export function ConversationList({
    conversations, currentUserId, onlineUsers, selectedId, loading, error, onRetry, retrying,
    query, onQueryChange, view, onViewChange, unreadCount,
    selectMode, checkedIds, onStartSelect, onToggle, onCancelSelect, onDeleteChecked,
    onOpen, onShowMember, onDelete,
}: {
    conversations: DisplayConversation[];
    currentUserId: string;
    onlineUsers: Set<string>;
    selectedId: string | null;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    retrying: boolean;
    query: string;
    onQueryChange: (q: string) => void;
    view: ConversationView;
    onViewChange: (v: ConversationView) => void;
    unreadCount: number;
    selectMode: boolean;
    checkedIds: Set<string>;
    onStartSelect: (id?: string) => void;
    onToggle: (id: string) => void;
    onCancelSelect: () => void;
    onDeleteChecked: () => void;
    onOpen: (conv: DisplayConversation) => void;
    onShowMember: (userId: string) => void;
    onDelete: (id: string) => void;
}) {
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-3 border-b border-line p-3">
                {selectMode ? (
                    <div className="flex min-h-11 items-center gap-2">
                        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={onCancelSelect} aria-label="Annuler la sélection">
                            <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden="true" />
                        </Button>
                        <p className="flex-1 text-sm font-medium text-fg" aria-live="polite">
                            {checkedIds.size} sélectionnée{checkedIds.size > 1 ? 's' : ''}
                        </p>
                        <Can module="communication" write>
                            <Button variant="danger-ghost" size="lg" onClick={onDeleteChecked} disabled={checkedIds.size === 0}>
                                <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" /> Supprimer
                            </Button>
                        </Can>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <div className="relative min-w-0 flex-1">
                            <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
                            <Input
                                type="search"
                                aria-label="Rechercher une conversation"
                                placeholder="Rechercher un membre"
                                value={query}
                                onChange={e => onQueryChange(e.target.value)}
                                className="h-11 pl-9 md:h-9"
                            />
                        </div>
                        <Can module="communication" write>
                            <Tooltip content="Sélectionner des conversations">
                                <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 md:h-9 md:w-9" onClick={() => onStartSelect()} aria-label="Sélectionner des conversations">
                                    <HugeiconsIcon icon={CheckListIcon} size={18} aria-hidden="true" />
                                </Button>
                            </Tooltip>
                        </Can>
                    </div>
                )}
                <Segmented
                    label="Conversations affichées"
                    value={view}
                    onValueChange={onViewChange}
                    fill
                    size="sm"
                    options={[
                        { value: 'toutes', label: 'Toutes' },
                        { value: 'non-lues', label: unreadCount > 0 ? `Non lues (${unreadCount})` : 'Non lues' },
                    ]}
                />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {loading ? (
                    <div className="space-y-1 p-3" aria-busy="true">
                        {Array.from({ length: 7 }, (_, i) => (
                            <div key={i} className="flex items-center gap-3 py-2">
                                <Skeleton className="h-11 w-11 rounded-full" />
                                <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-1/2" /><Skeleton className="h-3 w-4/5" /></div>
                            </div>
                        ))}
                    </div>
                ) : error ? (
                    <ErrorState title="Les conversations n’ont pas pu être chargées" message={error} onRetry={onRetry} retrying={retrying} />
                ) : conversations.length === 0 ? (
                    <EmptyState
                        icon={MessageMultiple01Icon}
                        title={query ? 'Aucune conversation trouvée' : view === 'non-lues' ? 'Tout est lu' : 'Aucune conversation'}
                        description={query ? 'Vérifiez le nom, ou démarrez une nouvelle conversation.' : view === 'non-lues' ? 'Aucun message en attente de lecture.' : 'Écrivez à un membre pour démarrer.'}
                    />
                ) : (
                    <ul className="divide-y divide-line">
                        {conversations.map(conv => (
                            <ConversationRow
                                key={conv._id}
                                conversation={conv}
                                currentUserId={currentUserId}
                                online={onlineUsers.has(otherParticipant(conv, currentUserId)._id)}
                                selected={selectedId === conv._id}
                                selectMode={selectMode}
                                checked={checkedIds.has(conv._id)}
                                onOpen={() => onOpen(conv)}
                                onToggle={() => onToggle(conv._id)}
                                onStartSelect={() => onStartSelect(conv._id)}
                                onShowMember={onShowMember}
                                onDelete={() => onDelete(conv._id)}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
