import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowTurnForwardIcon, Search01Icon } from '@hugeicons/core-free-icons';
import { getAvatarUrl } from '../../api/apiClient';
import type { Conversation } from '../../services/chatApi';
import { Avatar, Button, Checkbox, Dialog, DialogContent, Input } from '../ui';
import { otherParticipant } from './chat-utils';

/** Pick the conversations that receive the selected messages. */
export function ForwardDialog({ open, onOpenChange, conversations, currentUserId, messageCount, onForward }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    conversations: Conversation[];
    currentUserId: string;
    messageCount: number;
    onForward: (targetConversationIds: string[]) => Promise<void>;
}) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(false);

    const filtered = conversations.filter(conv => {
        if (!query) return true;
        return otherParticipant(conv, currentUserId)?.name?.toLowerCase().includes(query.toLowerCase());
    });

    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const close = (next: boolean) => {
        if (busy) return;
        if (!next) { setSelected(new Set()); setQuery(''); }
        onOpenChange(next);
    };

    const forward = async () => {
        if (selected.size === 0) return;
        setBusy(true);
        try {
            await onForward(Array.from(selected));
            setSelected(new Set());
            setQuery('');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent
                title={`Transférer ${messageCount} message${messageCount > 1 ? 's' : ''}`}
                description="Choisissez une ou plusieurs conversations."
                footer={(
                    <Button variant="primary" size="lg" onClick={() => void forward()} disabled={selected.size === 0} loading={busy}>
                        <HugeiconsIcon icon={ArrowTurnForwardIcon} size={16} aria-hidden="true" />
                        Transférer{selected.size > 0 ? ` vers ${selected.size} conversation${selected.size > 1 ? 's' : ''}` : ''}
                    </Button>
                )}
            >
                <div className="relative">
                    <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
                    <Input
                        type="search"
                        aria-label="Rechercher une conversation"
                        placeholder="Rechercher une conversation"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        className="h-11 pl-9"
                    />
                </div>
                <ul className="-mx-2 mt-3 divide-y divide-line">
                    {filtered.length === 0 && <li className="px-2 py-6 text-center text-sm text-fg-muted">Aucune conversation.</li>}
                    {filtered.map(conv => {
                        const p = otherParticipant(conv, currentUserId);
                        const checked = selected.has(conv._id);
                        return (
                            <li key={conv._id}>
                                <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-control px-2 py-2 hover:bg-surface-2">
                                    <Checkbox checked={checked} onCheckedChange={() => toggle(conv._id)} aria-label={`Choisir ${p?.name || 'Inconnu'}`} />
                                    <Avatar src={getAvatarUrl(p?.avatar)} name={p?.name || '?'} size="sm" />
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{p?.name || 'Inconnu'}</span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            </DialogContent>
        </Dialog>
    );
}
