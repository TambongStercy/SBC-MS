import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { MessageAdd01Icon, Message01Icon } from '@hugeicons/core-free-icons';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../context/AuthContext';
import {
    getConversations,
    getMessagesGrouped,
    sendMessage as sendMessageApi,
    markConversationAsRead,
    getOrCreateConversation,
    deleteMessage as deleteMessageApi,
    deleteMessages as deleteMessagesApi,
    deleteConversation as deleteConversationApi,
    deleteConversations as deleteConversationsApi,
    forwardMessages as forwardMessagesApi,
    Conversation,
    Message,
    MessageGroup,
} from '../services/chatApi';
import type { AdminUserData } from '../services/adminUserApi';
import { cn } from '../lib/cn';
import { Can } from '../components/Can';
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui';
import { apiError } from '../components/display/format';
import { useUrlParams } from '../components/display/useUrlParams';
import {
    byLastMessage, dateGroupOf, isPendingConversation, otherParticipant, type DisplayConversation, type PendingConversation,
} from '../components/chat/chat-utils';
import { ConfirmDialog, type ConfirmRequest } from '../components/chat/ConfirmDialog';
import { ConversationList, type ConversationView } from '../components/chat/ConversationList';
import { ConversationPane } from '../components/chat/ConversationPane';
import { ForwardDialog } from '../components/chat/ForwardDialog';
import { MemberInfoSheet } from '../components/chat/MemberInfoSheet';
import { NewConversationSheet } from '../components/chat/NewConversationSheet';

const URL_DEFAULTS = { q: '', vue: 'toutes' };

/**
 * Messages: the admin's own chat with members (chat-service, live over the
 * socket). Two panes on a computer; on a phone, the list or the open
 * conversation (?c=<id> in the URL, so "back" returns to the list).
 */
const ChatPage: React.FC = () => {
    const { socket, isConnected, onlineUsers, joinConversation, leaveConversation, sendTypingStart, sendTypingStop } = useSocket();
    const { adminUser } = useAuth();
    const currentUserId = useMemo(() => adminUser?._id || '', [adminUser]);

    const filters = useUrlParams(URL_DEFAULTS);
    const searchQuery = filters.get('q');
    const view = (filters.get('vue') === 'non-lues' ? 'non-lues' : 'toutes') as ConversationView;
    const [searchParams, setSearchParams] = useSearchParams();
    const urlConversationId = searchParams.get('c');

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [pendingConversations, setPendingConversations] = useState<PendingConversation[]>([]);
    const [selectedConversation, setSelectedConversation] = useState<DisplayConversation | null>(null);
    const [messageGroups, setMessageGroups] = useState<MessageGroup[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [reloading, setReloading] = useState(false);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
    const [sendingFirstMessage, setSendingFirstMessage] = useState(false);

    const [showNewChat, setShowNewChat] = useState(false);
    const [memberInfoId, setMemberInfoId] = useState<string | null>(null);
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);

    const [messageSelectMode, setMessageSelectMode] = useState(false);
    const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
    const [conversationSelectMode, setConversationSelectMode] = useState(false);
    const [selectedConversationsSet, setSelectedConversationsSet] = useState<Set<string>>(new Set());
    const [showForward, setShowForward] = useState(false);
    const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const allConversations = useMemo(
        () => [...pendingConversations, ...conversations] as DisplayConversation[],
        [conversations, pendingConversations],
    );

    // Flat list of the open conversation's messages
    const messages = useMemo(() => messageGroups.flatMap(group => group.messages), [messageGroups]);

    const scrollToBottom = () => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 100);
    };

    /** Opens a conversation (or closes it with null) and keeps ?c= in step, so "back" works on phones. */
    const openConversation = useCallback((conv: DisplayConversation | null, replace = false) => {
        setSelectedConversation(conv);
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (conv) next.set('c', conv._id); else next.delete('c');
            return next;
        }, { replace });
    }, [setSearchParams]);

    // Adds a message to its date group (live messages, sends)
    const addMessageToGroups = useCallback((message: Message) => {
        const { date: dateKey, dateLabel } = dateGroupOf(message.createdAt);
        setMessageGroups(prev => {
            const existingGroupIndex = prev.findIndex(g => g.date === dateKey);
            if (existingGroupIndex >= 0) {
                const updated = [...prev];
                updated[existingGroupIndex] = {
                    ...updated[existingGroupIndex],
                    messages: [...updated[existingGroupIndex].messages, message],
                };
                return updated;
            }
            return [...prev, { date: dateKey, dateLabel, messages: [message] }].sort((a, b) => a.date.localeCompare(b.date));
        });
    }, []);

    // Load conversations
    const loadConversations = useCallback(async () => {
        try {
            setLoadError(null);
            const response = await getConversations();
            setConversations(response.data);
        } catch (error) {
            console.error('Failed to load conversations:', error);
            setLoadError(apiError(error, 'Vérifiez la connexion, puis réessayez.'));
        } finally {
            setLoading(false);
            setReloading(false);
        }
    }, []);

    useEffect(() => { void loadConversations(); }, [loadConversations]);

    // ?c= in the URL: open that conversation once the list is there; gone (back button): close it.
    const selectedId = selectedConversation?._id ?? null;
    useEffect(() => {
        if (!urlConversationId) {
            if (selectedId) setSelectedConversation(null);
            return;
        }
        if (urlConversationId !== selectedId && !loading) {
            const found = allConversations.find(c => c._id === urlConversationId);
            if (found) setSelectedConversation(found);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the URL or the first load changes
    }, [urlConversationId, loading]);

    // Socket event listeners
    useEffect(() => {
        if (!socket) return;

        const handleNewMessage = (message: Message) => {
            if (selectedConversation && message.conversationId === selectedConversation._id) {
                addMessageToGroups(message);
                scrollToBottom();
            }

            setConversations(prev => {
                const updated = prev.map(conv => {
                    if (conv._id === message.conversationId) {
                        return {
                            ...conv,
                            lastMessage: { content: message.content, senderId: message.senderId, createdAt: message.createdAt },
                            lastMessageAt: message.createdAt,
                            unreadCount: selectedConversation?._id === conv._id ? 0 : conv.unreadCount + 1,
                        };
                    }
                    return conv;
                });
                return updated.sort(byLastMessage);
            });
        };

        const handleTypingStart = ({ userId, userName, conversationId }: { userId: string; userName: string; conversationId: string }) => {
            if (selectedConversation?._id === conversationId) {
                setTypingUsers(prev => new Map(prev).set(userId, userName));
            }
        };

        const handleTypingStop = ({ userId, conversationId }: { userId: string; conversationId: string }) => {
            if (selectedConversation?._id === conversationId) {
                setTypingUsers(prev => {
                    const updated = new Map(prev);
                    updated.delete(userId);
                    return updated;
                });
            }
        };

        const handleMessageRead = ({ conversationId, readBy }: { conversationId: string; readBy: string }) => {
            if (selectedConversation?._id === conversationId) {
                setMessageGroups(prev => prev.map(group => ({
                    ...group,
                    messages: group.messages.map(msg => ({
                        ...msg,
                        readBy: msg.readBy.includes(readBy) ? msg.readBy : [...msg.readBy, readBy],
                        status: 'read' as const,
                    })),
                })));
            }
        };

        socket.on('message:new', handleNewMessage);
        socket.on('message:notification', handleNewMessage);
        socket.on('typing:start', handleTypingStart);
        socket.on('typing:stop', handleTypingStop);
        socket.on('message:read', handleMessageRead);

        return () => {
            socket.off('message:new', handleNewMessage);
            socket.off('message:notification', handleNewMessage);
            socket.off('typing:start', handleTypingStart);
            socket.off('typing:stop', handleTypingStop);
            socket.off('message:read', handleMessageRead);
        };
    }, [socket, selectedConversation, addMessageToGroups]);

    // Load messages when a conversation is opened
    useEffect(() => {
        if (!selectedConversation) return;

        // Leave selection mode when changing conversations
        setMessageSelectMode(false);
        setSelectedMessages(new Set());
        setReplyingTo(null);

        if (isPendingConversation(selectedConversation)) {
            setMessageGroups([]);
            setMessagesLoading(false);
            return;
        }

        const loadMessages = async () => {
            setMessagesLoading(true);
            try {
                const response = await getMessagesGrouped(selectedConversation._id);
                setMessageGroups(response.data);
                scrollToBottom();
                await markConversationAsRead(selectedConversation._id);
                setConversations(prev => prev.map(conv =>
                    conv._id === selectedConversation._id ? { ...conv, unreadCount: 0 } : conv,
                ));
            } catch (error) {
                console.error('Failed to load messages:', error);
                toast.error(apiError(error, 'Les messages n’ont pas pu être chargés.'));
            } finally {
                setMessagesLoading(false);
            }
        };

        joinConversation(selectedConversation._id);
        loadMessages();

        return () => {
            leaveConversation(selectedConversation._id);
        };
    }, [selectedConversation, joinConversation, leaveConversation]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMessage.trim() || !selectedConversation) return;

        const messageContent = newMessage.trim();
        const replyToId = replyingTo?._id;
        setNewMessage('');
        setReplyingTo(null);

        try {
            if (isPendingConversation(selectedConversation)) {
                setSendingFirstMessage(true);
                const pendingUser = selectedConversation.pendingUser;
                const realConversation = await getOrCreateConversation(pendingUser._id);
                const message = await sendMessageApi(realConversation._id, messageContent, replyToId);
                setPendingConversations(prev => prev.filter(p => p._id !== selectedConversation._id));

                const updatedConversation = {
                    ...realConversation,
                    lastMessage: { content: message.content, senderId: message.senderId, createdAt: message.createdAt },
                    lastMessageAt: message.createdAt,
                };

                setConversations(prev => {
                    const exists = prev.find(c => c._id === realConversation._id);
                    if (exists) {
                        return prev.map(c => (c._id === realConversation._id ? updatedConversation : c)).sort(byLastMessage);
                    }
                    return [updatedConversation, ...prev];
                });

                openConversation(updatedConversation, true);
                addMessageToGroups(message);
                joinConversation(realConversation._id);
                setSendingFirstMessage(false);
            } else {
                const message = await sendMessageApi(selectedConversation._id, messageContent, replyToId);
                addMessageToGroups(message);
                sendTypingStop(selectedConversation._id);

                setConversations(prev => prev.map(conv => (conv._id === selectedConversation._id
                    ? { ...conv, lastMessage: { content: message.content, senderId: message.senderId, createdAt: message.createdAt }, lastMessageAt: message.createdAt }
                    : conv)).sort(byLastMessage));
            }
            scrollToBottom();
        } catch (error) {
            console.error('Failed to send message:', error);
            toast.error(apiError(error, 'Le message n’est pas parti. Il est resté dans la zone de saisie.'));
            setNewMessage(messageContent);
            setSendingFirstMessage(false);
        }
    };

    const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
        setNewMessage(e.target.value);
        if (!selectedConversation || isPendingConversation(selectedConversation)) return;
        sendTypingStart(selectedConversation._id);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            sendTypingStop(selectedConversation._id);
        }, 2000);
    };

    const unreadCount = conversations.filter(c => c.unreadCount > 0).length;
    const filteredConversations = allConversations.filter(conv => {
        if (view === 'non-lues' && conv.unreadCount === 0) return false;
        if (!searchQuery) return true;
        return otherParticipant(conv, currentUserId).name.toLowerCase().includes(searchQuery.toLowerCase());
    });

    // Message actions
    const copy = (text: string, done: string) => {
        navigator.clipboard.writeText(text).then(() => toast.success(done), () => toast.error('La copie a échoué.'));
    };

    const handleReply = (message: Message) => {
        setReplyingTo(message);
        inputRef.current?.focus();
    };

    const handleDeleteMessage = (messageId: string) => {
        setConfirm({
            title: 'Supprimer le message ?',
            message: 'Le message disparaît de la conversation.',
            warning: 'Cette action est irréversible.',
            onConfirm: async () => {
                try {
                    await deleteMessageApi(messageId);
                    setMessageGroups(prev => prev.map(group => ({
                        ...group,
                        messages: group.messages.filter(m => m._id !== messageId),
                    })).filter(group => group.messages.length > 0));
                    toast.success('Message supprimé.');
                } catch (error) {
                    console.error('Failed to delete message:', error);
                    toast.error(apiError(error, 'Le message n’a pas pu être supprimé.'));
                }
            },
        });
    };

    const handleDeleteSelectedMessages = () => {
        if (selectedMessages.size === 0) return;
        const count = selectedMessages.size;
        const ids = new Set(selectedMessages);
        setConfirm({
            title: `Supprimer ${count} message${count > 1 ? 's' : ''} ?`,
            message: 'Les messages sélectionnés disparaissent de la conversation.',
            warning: 'Cette action est irréversible.',
            onConfirm: async () => {
                try {
                    await deleteMessagesApi(Array.from(ids));
                    setMessageGroups(prev => prev.map(group => ({
                        ...group,
                        messages: group.messages.filter(m => !ids.has(m._id)),
                    })).filter(group => group.messages.length > 0));
                    setSelectedMessages(new Set());
                    setMessageSelectMode(false);
                    toast.success(`${count} message${count > 1 ? 's supprimés' : ' supprimé'}.`);
                } catch (error) {
                    console.error('Failed to delete messages:', error);
                    toast.error(apiError(error, 'Les messages n’ont pas pu être supprimés.'));
                }
            },
        });
    };

    const handleCopySelectedMessages = () => {
        const text = messages.filter(m => selectedMessages.has(m._id)).map(m => m.content).join('\n');
        copy(text, 'Messages copiés.');
        setSelectedMessages(new Set());
        setMessageSelectMode(false);
    };

    const handleForward = async (targetConversationIds: string[]) => {
        try {
            const forwardedMessageContent = messages.find(m => selectedMessages.has(m._id))?.content || 'Message transféré';
            await forwardMessagesApi(Array.from(selectedMessages), targetConversationIds);

            setConversations(prev => prev.map(conv => (targetConversationIds.includes(conv._id)
                ? {
                    ...conv,
                    lastMessage: { content: forwardedMessageContent, senderId: currentUserId, createdAt: new Date().toISOString() },
                    lastMessageAt: new Date().toISOString(),
                }
                : conv)).sort(byLastMessage));

            // Forwarded into the open conversation: reload it
            if (selectedConversation && targetConversationIds.includes(selectedConversation._id)) {
                const response = await getMessagesGrouped(selectedConversation._id);
                setMessageGroups(response.data);
                scrollToBottom();
            }

            const n = selectedMessages.size;
            setSelectedMessages(new Set());
            setMessageSelectMode(false);
            setShowForward(false);
            toast.success(`${n} message${n > 1 ? 's transférés' : ' transféré'}.`);
        } catch (error) {
            console.error('Failed to forward messages:', error);
            toast.error(apiError(error, 'Le transfert a échoué.'));
        }
    };

    const toggleMessageSelection = (messageId: string) => {
        setSelectedMessages(prev => {
            const next = new Set(prev);
            if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
            return next;
        });
    };

    // Conversation actions
    const handleDeleteConversation = (conversationId: string) => {
        setConfirm({
            title: 'Supprimer la conversation ?',
            message: 'La conversation et tous ses messages sont supprimés.',
            warning: 'Cette action est irréversible.',
            onConfirm: async () => {
                try {
                    await deleteConversationApi(conversationId);
                    setConversations(prev => prev.filter(c => c._id !== conversationId));
                    if (selectedConversation?._id === conversationId) openConversation(null, true);
                    toast.success('Conversation supprimée.');
                } catch (error) {
                    console.error('Failed to delete conversation:', error);
                    toast.error(apiError(error, 'La conversation n’a pas pu être supprimée.'));
                }
            },
        });
    };

    const handleDeleteSelectedConversations = () => {
        if (selectedConversationsSet.size === 0) return;
        const count = selectedConversationsSet.size;
        const ids = new Set(selectedConversationsSet);
        setConfirm({
            title: `Supprimer ${count} conversation${count > 1 ? 's' : ''} ?`,
            message: 'Les conversations sélectionnées et tous leurs messages sont supprimés.',
            warning: 'Cette action est irréversible.',
            onConfirm: async () => {
                try {
                    await deleteConversationsApi(Array.from(ids));
                    setConversations(prev => prev.filter(c => !ids.has(c._id)));
                    if (selectedConversation && ids.has(selectedConversation._id)) openConversation(null, true);
                    setSelectedConversationsSet(new Set());
                    setConversationSelectMode(false);
                    toast.success(`${count} conversation${count > 1 ? 's supprimées' : ' supprimée'}.`);
                } catch (error) {
                    console.error('Failed to delete conversations:', error);
                    toast.error(apiError(error, 'Les conversations n’ont pas pu être supprimées.'));
                }
            },
        });
    };

    const toggleConversationSelection = (conversationId: string) => {
        setSelectedConversationsSet(prev => {
            const next = new Set(prev);
            if (next.has(conversationId)) next.delete(conversationId); else next.add(conversationId);
            return next;
        });
    };

    const handleStartConversation = (user: AdminUserData) => {
        const existingConversation = conversations.find(c => c.participants.some(p => p._id === user._id));
        if (existingConversation) {
            openConversation(existingConversation);
        } else {
            const existingPending = pendingConversations.find(p => p.pendingUser._id === user._id);
            if (existingPending) {
                openConversation(existingPending);
            } else {
                const pendingConv: PendingConversation = {
                    isPending: true,
                    pendingUser: user,
                    _id: `pending_${user._id}`,
                    participants: [
                        { _id: currentUserId, name: adminUser?.name || 'Admin', avatar: adminUser?.avatar },
                        { _id: user._id, name: user.name, avatar: user.avatar },
                    ],
                    unreadCount: 0,
                };
                setPendingConversations(prev => [pendingConv, ...prev]);
                openConversation(pendingConv);
            }
        }
        setShowNewChat(false);
    };

    const open = !!selectedConversation;
    const newButton = (
        <Can module="communication" write>
            <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={() => setShowNewChat(true)}>
                <HugeiconsIcon icon={MessageAdd01Icon} size={18} aria-hidden="true" />
                Nouvelle conversation
            </Button>
        </Can>
    );

    return (
        // Fills the screen under the header (and above the phone bar): the panes scroll, not the page.
        <div className="flex h-[calc(100dvh-145px)] flex-col gap-4 md:h-[calc(100dvh-104px)]">
            <PageHeader
                title={(
                    <span className="flex items-center gap-2">
                        Messages
                        <Badge tone={isConnected ? 'success' : 'neutral'} className="align-middle">
                            <span className={cn('h-1.5 w-1.5 rounded-full', isConnected ? 'bg-success' : 'bg-fg-subtle')} aria-hidden="true" />
                            {isConnected ? 'En direct' : 'Hors ligne'}
                        </Badge>
                    </span>
                )}
                description={unreadCount > 0
                    ? `${unreadCount} conversation${unreadCount > 1 ? 's' : ''} avec des messages non lus. Vous écrivez aux membres au nom de l’équipe SBC.`
                    : 'Vous écrivez aux membres au nom de l’équipe SBC. Les nouveaux messages arrivent en direct.'}
                actions={newButton}
                className={cn('mb-0 shrink-0', open && 'hidden md:flex')}
            />

            <Panel className="flex min-h-0 flex-1 overflow-hidden">
                <div className={cn('min-h-0 w-full flex-col border-line md:flex md:w-80 md:border-r lg:w-96', open ? 'hidden' : 'flex')}>
                    <ConversationList
                        conversations={filteredConversations}
                        currentUserId={currentUserId}
                        onlineUsers={onlineUsers}
                        selectedId={selectedConversation?._id ?? null}
                        loading={loading}
                        error={loadError}
                        onRetry={() => { setReloading(true); void loadConversations(); }}
                        retrying={reloading}
                        query={searchQuery}
                        onQueryChange={q => filters.set({ q })}
                        view={view}
                        onViewChange={v => filters.set({ vue: v })}
                        unreadCount={unreadCount}
                        selectMode={conversationSelectMode}
                        checkedIds={selectedConversationsSet}
                        onStartSelect={id => {
                            setConversationSelectMode(true);
                            setSelectedConversationsSet(id ? new Set([id]) : new Set());
                        }}
                        onToggle={toggleConversationSelection}
                        onCancelSelect={() => { setConversationSelectMode(false); setSelectedConversationsSet(new Set()); }}
                        onDeleteChecked={handleDeleteSelectedConversations}
                        onOpen={conv => openConversation(conv)}
                        onShowMember={setMemberInfoId}
                        onDelete={handleDeleteConversation}
                    />
                </div>

                <div className={cn('min-h-0 min-w-0 flex-1 flex-col md:flex', open ? 'flex' : 'hidden')}>
                    {selectedConversation ? (
                        <ConversationPane
                            conversation={selectedConversation}
                            currentUserId={currentUserId}
                            online={onlineUsers.has(otherParticipant(selectedConversation, currentUserId)._id)}
                            messageGroups={messageGroups}
                            loading={messagesLoading}
                            typingNames={Array.from(typingUsers.values())}
                            selectMode={messageSelectMode}
                            selectedIds={selectedMessages}
                            onStartSelect={id => { setMessageSelectMode(true); setSelectedMessages(id ? new Set([id]) : new Set()); }}
                            onToggle={toggleMessageSelection}
                            onCancelSelect={() => { setMessageSelectMode(false); setSelectedMessages(new Set()); }}
                            onCopySelected={handleCopySelectedMessages}
                            onForwardSelected={() => { if (selectedMessages.size > 0) setShowForward(true); }}
                            onDeleteSelected={handleDeleteSelectedMessages}
                            onBack={() => openConversation(null)}
                            onShowMember={setMemberInfoId}
                            onDeleteConversation={() => handleDeleteConversation(selectedConversation._id)}
                            onReply={handleReply}
                            onCopy={m => copy(m.content, 'Message copié.')}
                            onForward={m => { setSelectedMessages(new Set([m._id])); setShowForward(true); }}
                            onDelete={m => handleDeleteMessage(m._id)}
                            replyingTo={replyingTo}
                            onCancelReply={() => setReplyingTo(null)}
                            draft={newMessage}
                            onDraftChange={handleTyping}
                            onSend={handleSendMessage}
                            sending={sendingFirstMessage}
                            inputRef={inputRef}
                            endRef={messagesEndRef}
                        />
                    ) : (
                        <EmptyState
                            icon={Message01Icon}
                            title="Choisissez une conversation"
                            description="Ouvrez une conversation à gauche pour lire et répondre."
                            className="flex-1"
                        />
                    )}
                </div>
            </Panel>

            <NewConversationSheet open={showNewChat} onOpenChange={setShowNewChat} onPick={handleStartConversation} />
            <MemberInfoSheet userId={memberInfoId} onClose={() => setMemberInfoId(null)} />
            <ForwardDialog
                open={showForward}
                onOpenChange={o => { setShowForward(o); }}
                conversations={conversations}
                currentUserId={currentUserId}
                messageCount={selectedMessages.size}
                onForward={handleForward}
            />
            <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
};

export default ChatPage;
