import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    ArrowTurnBackwardIcon, ArrowTurnForwardIcon, Attachment01Icon, Copy01Icon, Delete02Icon, MoreHorizontalIcon, Tick02Icon, TickDouble02Icon,
} from '@hugeicons/core-free-icons';
import type { Message } from '../../services/chatApi';
import { cn } from '../../lib/cn';
import { usePermission } from '../../hooks/usePermission';
import { Button, Checkbox, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '../ui';
import { fmtDateTime } from '../display/format';
import { formatChatTime } from './chat-utils';
import { useLongPress } from './useLongPress';

const STATUS_LABEL = { sent: 'Envoyé', delivered: 'Distribué', read: 'Lu' } as const;

/**
 * One message. Its actions (reply, copy, forward, delete) are in the ⋯ menu,
 * also opened by a right click; a long press starts selecting messages.
 */
export function MessageBubble({ message, isMine, selectMode, selected, onToggle, onStartSelect, onReply, onCopy, onForward, onDelete }: {
    message: Message;
    isMine: boolean;
    selectMode: boolean;
    selected: boolean;
    onToggle: () => void;
    onStartSelect: () => void;
    onReply: () => void;
    onCopy: () => void;
    onForward: () => void;
    onDelete: () => void;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const canWrite = usePermission('communication') === 'write';
    const press = useLongPress(() => { if (!selectMode) onStartSelect(); }, () => { if (selectMode) onToggle(); });

    const menu = (
            <Menu open={menuOpen} onOpenChange={setMenuOpen}>
                <MenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-fg-subtle md:h-8 md:w-8 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
                        aria-label="Actions sur le message"
                    >
                        <HugeiconsIcon icon={MoreHorizontalIcon} size={16} aria-hidden="true" />
                    </Button>
                </MenuTrigger>
                <MenuContent align={isMine ? 'end' : 'start'}>
                    {canWrite && (
                        <MenuItem onSelect={onReply}>
                            <HugeiconsIcon icon={ArrowTurnBackwardIcon} size={16} aria-hidden="true" /> Répondre
                        </MenuItem>
                    )}
                    <MenuItem onSelect={onCopy}>
                        <HugeiconsIcon icon={Copy01Icon} size={16} aria-hidden="true" /> Copier
                    </MenuItem>
                    {canWrite && (
                        <>
                            <MenuItem onSelect={onForward}>
                                <HugeiconsIcon icon={ArrowTurnForwardIcon} size={16} aria-hidden="true" /> Transférer
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem destructive onSelect={onDelete}>
                                <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" /> Supprimer
                            </MenuItem>
                        </>
                    )}
                </MenuContent>
            </Menu>
    );

    return (
        <div
            {...press}
            onContextMenu={e => { if (!selectMode) { e.preventDefault(); setMenuOpen(true); } }}
            className={cn(
                'group flex items-center gap-2 rounded-control px-1 py-0.5',
                isMine ? 'justify-end' : 'justify-start',
                selectMode && 'cursor-pointer',
                selected && 'bg-primary-soft',
            )}
        >
            {selectMode && (
                <Checkbox checked={selected} onCheckedChange={onToggle} aria-label="Sélectionner ce message" className={cn('h-5 w-5', isMine && 'order-first mr-auto')} />
            )}
            {!selectMode && isMine && menu}
            <div className="min-w-0 max-w-[85%] sm:max-w-[70%]">
                {message.replyTo && (
                    <div className={cn('mb-1 rounded-control border-l-2 bg-surface-2 px-3 py-1 text-xs', isMine ? 'border-primary' : 'border-line-strong')}>
                        <p className="font-medium text-fg-muted">{message.replyTo.senderName || 'Utilisateur'}</p>
                        <p className="truncate text-fg-muted">{message.replyTo.content}</p>
                    </div>
                )}
                <div className={cn('whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm', isMine ? 'rounded-br-md bg-primary text-primary-fg' : 'rounded-bl-md bg-surface-2 text-fg')}>
                    {message.type === 'document' ? (
                        <a href={message.documentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 underline-offset-2 hover:underline">
                            <HugeiconsIcon icon={Attachment01Icon} size={16} aria-hidden="true" />
                            {message.documentName || 'Document'}
                        </a>
                    ) : (
                        <p>{message.content}</p>
                    )}
                </div>
                <div className={cn('mt-0.5 flex items-center gap-1 text-xs text-fg-subtle', isMine ? 'justify-end' : 'justify-start')}>
                    <Tooltip content={fmtDateTime(message.createdAt)}>
                        <span className="tabular-nums">{formatChatTime(message.createdAt)}</span>
                    </Tooltip>
                    {isMine && (
                        <span title={STATUS_LABEL[message.status]} aria-label={STATUS_LABEL[message.status]} className={cn(message.status === 'read' && 'text-primary')}>
                            <HugeiconsIcon icon={message.status === 'sent' ? Tick02Icon : TickDouble02Icon} size={14} aria-hidden="true" />
                        </span>
                    )}
                </div>
            </div>
            {!selectMode && !isMine && menu}
        </div>
    );
}
