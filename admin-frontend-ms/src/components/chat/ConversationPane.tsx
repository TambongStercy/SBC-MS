import type { ChangeEvent, FormEvent, RefObject } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    ArrowLeft01Icon, ArrowTurnForwardIcon, Cancel01Icon, CheckListIcon, Copy01Icon, Delete02Icon, Message01Icon, MoreVerticalIcon, SentIcon, UserIcon,
} from '@hugeicons/core-free-icons';
import { getAvatarUrl } from '../../api/apiClient';
import type { Message, MessageGroup } from '../../services/chatApi';
import { Can } from '../Can';
import { Avatar, Badge, Button, EmptyState, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Skeleton, Tooltip } from '../ui';
import { isPendingConversation, otherParticipant, type DisplayConversation } from './chat-utils';
import { MessageBubble } from './MessageBubble';

/** Right pane: the open conversation, its messages and the composer. */
export function ConversationPane({
    conversation, currentUserId, online, messageGroups, loading, typingNames,
    selectMode, selectedIds, onStartSelect, onToggle, onCancelSelect, onCopySelected, onForwardSelected, onDeleteSelected,
    onBack, onShowMember, onDeleteConversation,
    onReply, onCopy, onForward, onDelete,
    replyingTo, onCancelReply, draft, onDraftChange, onSend, sending, inputRef, endRef,
}: {
    conversation: DisplayConversation;
    currentUserId: string;
    online: boolean;
    messageGroups: MessageGroup[];
    loading: boolean;
    typingNames: string[];
    selectMode: boolean;
    selectedIds: Set<string>;
    onStartSelect: (messageId?: string) => void;
    onToggle: (messageId: string) => void;
    onCancelSelect: () => void;
    onCopySelected: () => void;
    onForwardSelected: () => void;
    onDeleteSelected: () => void;
    onBack: () => void;
    onShowMember: (userId: string) => void;
    onDeleteConversation: () => void;
    onReply: (m: Message) => void;
    onCopy: (m: Message) => void;
    onForward: (m: Message) => void;
    onDelete: (m: Message) => void;
    replyingTo: Message | null;
    onCancelReply: () => void;
    draft: string;
    onDraftChange: (e: ChangeEvent<HTMLInputElement>) => void;
    onSend: (e: FormEvent) => void;
    sending: boolean;
    inputRef: RefObject<HTMLInputElement>;
    endRef: RefObject<HTMLDivElement>;
}) {
    const pending = isPendingConversation(conversation);
    const other = otherParticipant(conversation, currentUserId);
    const memberId = pending ? conversation.pendingUser._id : other._id;
    const count = selectedIds.size;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* Header */}
            <div className="flex min-h-16 shrink-0 items-center gap-2 border-b border-line px-2 py-2 sm:px-3">
                {selectMode ? (
                    <>
                        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={onCancelSelect} aria-label="Annuler la sélection">
                            <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden="true" />
                        </Button>
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg" aria-live="polite">
                            {count} sélectionné{count > 1 ? 's' : ''}
                        </p>
                        <Tooltip content="Copier">
                            <Button variant="ghost" size="icon" className="h-11 w-11" onClick={onCopySelected} disabled={count === 0} aria-label="Copier les messages">
                                <HugeiconsIcon icon={Copy01Icon} size={18} aria-hidden="true" />
                            </Button>
                        </Tooltip>
                        <Can module="communication" write>
                            <Tooltip content="Transférer">
                                <Button variant="ghost" size="icon" className="h-11 w-11" onClick={onForwardSelected} disabled={count === 0} aria-label="Transférer les messages">
                                    <HugeiconsIcon icon={ArrowTurnForwardIcon} size={18} aria-hidden="true" />
                                </Button>
                            </Tooltip>
                            <Tooltip content="Supprimer">
                                <Button variant="danger-ghost" size="icon" className="h-11 w-11" onClick={onDeleteSelected} disabled={count === 0} aria-label="Supprimer les messages">
                                    <HugeiconsIcon icon={Delete02Icon} size={18} aria-hidden="true" />
                                </Button>
                            </Tooltip>
                        </Can>
                    </>
                ) : (
                    <>
                        <Button variant="ghost" size="icon" className="h-11 w-11 md:hidden" onClick={onBack} aria-label="Retour aux conversations">
                            <HugeiconsIcon icon={ArrowLeft01Icon} size={20} aria-hidden="true" />
                        </Button>
                        <button
                            type="button"
                            onClick={() => onShowMember(memberId)}
                            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-control px-1 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary"
                            aria-label={`Profil de ${other.name}`}
                        >
                            <span className="relative shrink-0">
                                <Avatar src={getAvatarUrl(other.avatar)} name={other.name || '?'} size="md" />
                                {online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface bg-success" />}
                            </span>
                            <span className="min-w-0">
                                <span className="flex items-center gap-2">
                                    <span className="truncate text-sm font-semibold text-fg">{other.name}</span>
                                    {pending && <Badge tone="outline">Brouillon</Badge>}
                                </span>
                                <span className="block truncate text-xs text-fg-muted">
                                    {pending ? 'Envoyez un message pour démarrer la conversation' : online ? 'En ligne' : 'Hors ligne'}
                                </span>
                            </span>
                        </button>
                        <Menu>
                            <MenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Actions sur la conversation">
                                    <HugeiconsIcon icon={MoreVerticalIcon} size={18} aria-hidden="true" />
                                </Button>
                            </MenuTrigger>
                            <MenuContent>
                                <MenuItem onSelect={() => onShowMember(memberId)}>
                                    <HugeiconsIcon icon={UserIcon} size={16} aria-hidden="true" /> Voir le profil
                                </MenuItem>
                                {!pending && (
                                    <MenuItem onSelect={() => onStartSelect()}>
                                        <HugeiconsIcon icon={CheckListIcon} size={16} aria-hidden="true" /> Sélectionner des messages
                                    </MenuItem>
                                )}
                                {!pending && (
                                    <Can module="communication" write>
                                        <MenuSeparator />
                                        <MenuItem destructive onSelect={onDeleteConversation}>
                                            <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" /> Supprimer la conversation
                                        </MenuItem>
                                    </Can>
                                )}
                            </MenuContent>
                        </Menu>
                    </>
                )}
            </div>

            {/* Messages */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3 sm:px-4" aria-live="polite" aria-relevant="additions">
                {loading ? (
                    <div className="space-y-4" aria-busy="true">
                        {[60, 40, 70, 35, 55].map((w, i) => (
                            <div key={i} className={i % 2 ? 'flex justify-end' : 'flex'}>
                                <Skeleton className="h-10 rounded-2xl" style={{ width: `${w}%` }} />
                            </div>
                        ))}
                    </div>
                ) : messageGroups.length === 0 ? (
                    <EmptyState icon={Message01Icon} title="Aucun message" description="Écrivez le premier message ci-dessous." />
                ) : (
                    messageGroups.map(group => (
                        <section key={group.date} aria-label={group.dateLabel} className="space-y-1">
                            <div className="sticky top-0 z-[1] flex justify-center py-2">
                                <span className="rounded-full border border-line bg-surface px-3 py-0.5 text-xs font-medium text-fg-muted">{group.dateLabel}</span>
                            </div>
                            {group.messages.map(message => (
                                <MessageBubble
                                    key={message._id}
                                    message={message}
                                    isMine={message.senderId === currentUserId}
                                    selectMode={selectMode}
                                    selected={selectedIds.has(message._id)}
                                    onToggle={() => onToggle(message._id)}
                                    onStartSelect={() => onStartSelect(message._id)}
                                    onReply={() => onReply(message)}
                                    onCopy={() => onCopy(message)}
                                    onForward={() => onForward(message)}
                                    onDelete={() => onDelete(message)}
                                />
                            ))}
                        </section>
                    ))
                )}
                {typingNames.length > 0 && (
                    <p className="flex items-center gap-2 px-1 pt-2 text-sm text-fg-muted">
                        <span className="flex gap-1" aria-hidden="true">
                            {[0, 150, 300].map(d => <span key={d} className="h-1.5 w-1.5 animate-pulse rounded-full bg-fg-subtle" style={{ animationDelay: `${d}ms` }} />)}
                        </span>
                        {typingNames.join(', ')} {typingNames.length > 1 ? 'écrivent' : 'écrit'}…
                    </p>
                )}
                <div ref={endRef} />
            </div>

            {/* Composer */}
            <Can
                module="communication"
                write
                fallback={<p className="shrink-0 border-t border-line px-4 py-3 text-center text-sm text-fg-muted">Lecture seule : vos droits ne permettent pas d’écrire aux membres.</p>}
            >
                <div className="shrink-0 border-t border-line bg-surface">
                    {replyingTo && (
                        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                            <div className="min-w-0 flex-1 border-l-2 border-primary pl-3">
                                <p className="text-xs font-medium text-primary">{replyingTo.senderId === currentUserId ? 'Réponse à votre message' : 'Réponse au message'}</p>
                                <p className="truncate text-sm text-fg-muted">{replyingTo.content}</p>
                            </div>
                            <Button variant="ghost" size="icon" className="h-11 w-11" onClick={onCancelReply} aria-label="Annuler la réponse">
                                <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden="true" />
                            </Button>
                        </div>
                    )}
                    <form onSubmit={onSend} className="flex items-center gap-2 p-2 sm:p-3">
                        <Input
                            ref={inputRef}
                            value={draft}
                            onChange={onDraftChange}
                            placeholder="Écrire un message…"
                            aria-label="Message"
                            className="h-11 min-w-0 flex-1 rounded-full px-4"
                            enterKeyHint="send"
                        />
                        <Button type="submit" variant="primary" size="icon" className="h-11 w-11 shrink-0 rounded-full" disabled={!draft.trim()} loading={sending} aria-label="Envoyer">
                            {!sending && <HugeiconsIcon icon={SentIcon} size={18} aria-hidden="true" />}
                        </Button>
                    </form>
                </div>
            </Can>
        </div>
    );
}
