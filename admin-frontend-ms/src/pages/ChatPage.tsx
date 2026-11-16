import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../context/AuthContext';
import {
    getConversations,
    getMessages,
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
    MessageGroup
} from '../services/chatApi';
import { listUsers, AdminUserData, getUserDetails, SubscriptionType, PartnerPack } from '../services/adminUserApi';
import {
    MessageCircle,
    Send,
    Search,
    MoreVertical,
    Paperclip,
    Check,
    CheckCheck,
    Circle,
    ArrowLeft,
    Plus,
    X,
    User,
    Loader2,
    Mail,
    Phone,
    MapPin,
    Calendar,
    Shield,
    Crown,
    Star,
    Wallet,
    Trash2,
    Reply,
    Copy,
    Forward,
    CheckSquare,
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    Filter,
    Globe,
    Briefcase,
    Heart
} from 'lucide-react';

const USER_FILTER_LABELS: Record<'all' | 'active' | 'blocked' | 'deleted', string> = {
    all: 'Tous',
    active: 'Actifs',
    blocked: 'Bloqués',
    deleted: 'Supprimés',
};

const ROLE_LABELS: Record<string, string> = {
    user: 'Utilisateur',
    admin: 'Administrateur',
    withdrawal_admin: 'Admin Retraits',
    tester: 'Testeur',
};

// Interface for pending (not yet created) conversations
interface PendingConversation {
    isPending: true;
    pendingUser: AdminUserData;
    _id: string; // Temporary local ID
    participants: Array<{ _id: string; name: string; avatar?: string }>;
    lastMessage?: { content: string; senderId: string; createdAt: string };
    lastMessageAt?: string;
    unreadCount: number;
}

// Type for displayed conversations (either real or pending)
type DisplayConversation = Conversation | PendingConversation;

// Type guard to check if conversation is pending
const isPendingConversation = (conv: DisplayConversation): conv is PendingConversation => {
    return 'isPending' in conv && conv.isPending === true;
};

// User Info Modal Component
interface UserInfoModalProps {
    userId: string | null;
    isOpen: boolean;
    onClose: () => void;
}

const UserInfoModal: React.FC<UserInfoModalProps> = ({ userId, isOpen, onClose }) => {
    const [user, setUser] = useState<AdminUserData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && userId) {
            setLoading(true);
            setError(null);
            getUserDetails(userId)
                .then(data => {
                    setUser(data);
                    setLoading(false);
                })
                .catch(err => {
                    console.error('Failed to fetch user details:', err);
                    setError('Impossible de charger les informations de l’utilisateur');
                    setLoading(false);
                });
        } else if (!isOpen) {
            setUser(null);
            setError(null);
        }
    }, [isOpen, userId]);

    if (!isOpen) return null;

    const formatPhone = (phone: string | number | undefined) => {
        if (!phone) return null;
        return String(phone);
    };

    const formatSubscriptions = (subscriptions: SubscriptionType[] | undefined) => {
        if (!subscriptions || subscriptions.length === 0) return null;
        return subscriptions.map(sub => {
            switch (sub) {
                case SubscriptionType.CLASSIQUE: return 'Classique';
                case SubscriptionType.CIBLE: return 'Ciblé';
                case SubscriptionType.RELANCE: return 'Relance';
                default: return sub;
            }
        }).join(', ');
    };

    const formatPartnerPack = (pack: PartnerPack | undefined) => {
        if (!pack || pack === PartnerPack.NONE) return null;
        switch (pack) {
            case PartnerPack.SILVER: return 'Partenaire Silver';
            case PartnerPack.GOLD: return 'Partenaire Gold';
            default: return pack;
        }
    };

    const formatBalance = (balance: number | undefined) => {
        if (balance === undefined) return null;
        return new Intl.NumberFormat('fr-FR').format(balance) + ' XAF';
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-surface rounded-lg w-full max-w-sm mx-4 overflow-hidden max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                {loading ? (
                    <div className="p-8 flex flex-col items-center justify-center">
                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                        <p className="text-fg-muted mt-2">Chargement…</p>
                    </div>
                ) : error ? (
                    <div className="p-8 text-center">
                        <p className="text-red-600 dark:text-red-400">{error}</p>
                        <button onClick={onClose} className="mt-4 px-4 py-2 bg-surface-2 text-fg rounded-lg hover:bg-surface-3 transition-colors">
                            Fermer
                        </button>
                    </div>
                ) : user ? (
                    <>
                        <div className="bg-linear-to-r from-indigo-600 to-purple-600 p-6 text-center">
                            <div className="w-24 h-24 mx-auto rounded-full border-4 border-white overflow-hidden bg-indigo-700">
                                {user.avatar ? (
                                    <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-white text-3xl font-bold">
                                        {user.name.charAt(0).toUpperCase()}
                                    </div>
                                )}
                            </div>
                            <h2 className="text-xl font-bold text-white mt-3">{user.name}</h2>
                            <div className="flex flex-wrap justify-center gap-2 mt-2">
                                {user.role && (
                                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-white/20 rounded-full text-white text-sm">
                                        <Shield className="w-3 h-3" />
                                        {ROLE_LABELS[user.role] ?? user.role}
                                    </span>
                                )}
                                {formatPartnerPack(user.partnerPack) && (
                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm ${user.partnerPack === PartnerPack.GOLD ? 'bg-yellow-500/30 text-yellow-200' : 'bg-white/20 text-white'}`}>
                                        <Crown className="w-3 h-3" />
                                        {formatPartnerPack(user.partnerPack)}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="p-4 space-y-3">
                            {user.email && (
                                <div className="flex items-center gap-3 text-fg-muted">
                                    <Mail className="w-5 h-5 text-fg-subtle shrink-0" />
                                    <span className="truncate">{user.email}</span>
                                </div>
                            )}
                            {formatPhone(user.phoneNumber) && (
                                <div className="flex items-center gap-3 text-fg-muted">
                                    <Phone className="w-5 h-5 text-fg-subtle shrink-0" />
                                    <span>{formatPhone(user.phoneNumber)}</span>
                                </div>
                            )}
                            {(user.city || user.country) && (
                                <div className="flex items-center gap-3 text-fg-muted">
                                    <MapPin className="w-5 h-5 text-fg-subtle shrink-0" />
                                    <span>{[user.city, user.country].filter(Boolean).join(', ')}</span>
                                </div>
                            )}
                            {formatSubscriptions(user.activeSubscriptionTypes) && (
                                <div className="flex items-start gap-3 text-fg-muted">
                                    <Star className="w-5 h-5 text-yellow-600 dark:text-yellow-500 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-xs text-fg-subtle mb-1">Abonnements actifs</p>
                                        <span className="text-green-600 dark:text-green-400">{formatSubscriptions(user.activeSubscriptionTypes)}</span>
                                    </div>
                                </div>
                            )}
                            {user.balance !== undefined && (
                                <div className="flex items-start gap-3 text-fg-muted">
                                    <Wallet className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-xs text-fg-subtle mb-1">Solde</p>
                                        <span>{formatBalance(user.balance)}</span>
                                        {user.usdBalance !== undefined && user.usdBalance > 0 && (
                                            <span className="ml-2 text-green-600 dark:text-green-400">({user.usdBalance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD)</span>
                                        )}
                                    </div>
                                </div>
                            )}
                            {user.createdAt && (
                                <div className="flex items-center gap-3 text-fg-muted">
                                    <Calendar className="w-5 h-5 text-fg-subtle shrink-0" />
                                    <span>Inscrit le {new Date(user.createdAt).toLocaleDateString('fr-FR')}</span>
                                </div>
                            )}
                            {(!user.activeSubscriptionTypes || user.activeSubscriptionTypes.length === 0) && (
                                <div className="flex items-center gap-3 text-fg-subtle">
                                    <Star className="w-5 h-5 shrink-0" />
                                    <span className="italic">Aucun abonnement actif</span>
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-line">
                            <button onClick={onClose} className="w-full py-2 bg-surface-2 text-fg rounded-lg hover:bg-surface-3 transition-colors">
                                Fermer
                            </button>
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
};

// Forward Modal Component
interface ForwardModalProps {
    isOpen: boolean;
    onClose: () => void;
    conversations: Conversation[];
    onForward: (targetConversationIds: string[]) => void;
    messageCount: number;
}

const ForwardModal: React.FC<ForwardModalProps> = ({ isOpen, onClose, conversations, onForward, messageCount }) => {
    const [selectedConversations, setSelectedConversations] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const { adminUser } = useAuth();
    const currentUserId = adminUser?._id || '';

    const getOtherParticipant = (conv: Conversation) => {
        return conv.participants.find(p => p._id !== currentUserId) || conv.participants[0];
    };

    const filteredConversations = conversations.filter(conv => {
        if (!searchQuery) return true;
        const participant = getOtherParticipant(conv);
        return participant?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    });

    const toggleConversation = (id: string) => {
        const newSelected = new Set(selectedConversations);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedConversations(newSelected);
    };

    const handleForward = () => {
        if (selectedConversations.size > 0) {
            onForward(Array.from(selectedConversations));
            setSelectedConversations(new Set());
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-surface rounded-lg w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
                <div className="p-4 border-b border-line flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-fg">Transférer {messageCount} message{messageCount > 1 ? 's' : ''}</h2>
                    <button onClick={onClose} className="text-fg-muted hover:text-fg">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-4 border-b border-line">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-fg-muted" />
                        <input
                            type="text"
                            placeholder="Rechercher une conversation"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-surface border border-line-strong rounded-lg text-fg placeholder-fg-subtle focus:outline-hidden focus:border-indigo-500"
                        />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {filteredConversations.map(conv => {
                        const participant = getOtherParticipant(conv);
                        const isSelected = selectedConversations.has(conv._id);
                        return (
                            <button
                                key={conv._id}
                                onClick={() => toggleConversation(conv._id)}
                                className={`w-full flex items-center gap-3 p-4 hover:bg-surface-2 transition-colors text-left ${isSelected ? 'bg-surface-2' : ''}`}
                            >
                                <div className={`w-5 h-5 rounded-sm border-2 flex items-center justify-center ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-line-strong'}`}>
                                    {isSelected && <Check className="w-3 h-3 text-white" />}
                                </div>
                                <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white font-semibold shrink-0 overflow-hidden">
                                    {participant?.avatar ? (
                                        <img src={participant.avatar} alt={participant.name} className="w-full h-full rounded-full object-cover" />
                                    ) : (
                                        participant?.name?.charAt(0).toUpperCase() || 'U'
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-fg truncate">{participant?.name || 'Inconnu'}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="p-4 border-t border-line">
                    <button
                        onClick={handleForward}
                        disabled={selectedConversations.size === 0}
                        className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    >
                        <Forward className="w-4 h-4" />
                        Transférer vers {selectedConversations.size} conversation{selectedConversations.size > 1 ? 's' : ''}
                    </button>
                </div>
            </div>
        </div>
    );
};

// Confirmation Modal Component
interface ConfirmationModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    warningMessage?: string;
    confirmText?: string;
    cancelText?: string;
    confirmButtonClass?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    title,
    message,
    warningMessage,
    confirmText = 'Supprimer',
    cancelText = 'Annuler',
    confirmButtonClass = 'bg-red-600 hover:bg-red-700',
    onConfirm,
    onCancel
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-surface rounded-lg w-full max-w-sm mx-4 overflow-hidden">
                <div className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5 text-red-500" />
                        </div>
                        <h2 className="text-lg font-semibold text-fg">{title}</h2>
                    </div>
                    <p className="text-fg-muted mb-2">{message}</p>
                    {warningMessage && (
                        <p className="text-sm text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded-lg">
                            {warningMessage}
                        </p>
                    )}
                </div>
                <div className="flex gap-3 p-4 border-t border-line">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-2 bg-surface-2 text-fg rounded-lg hover:bg-surface-3 transition-colors"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 py-2 text-white rounded-lg transition-colors ${confirmButtonClass}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

// Custom hook for long press detection
const useLongPress = (
    onLongPress: () => void,
    onClick?: () => void,
    { delay = 500 }: { delay?: number } = {}
) => {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const targetRef = useRef<EventTarget | null>(null);
    const isLongPressRef = useRef(false);

    const start = useCallback((event: React.TouchEvent | React.MouseEvent) => {
        targetRef.current = event.target;
        isLongPressRef.current = false;
        timeoutRef.current = setTimeout(() => {
            isLongPressRef.current = true;
            onLongPress();
        }, delay);
    }, [onLongPress, delay]);

    const clear = useCallback((event: React.TouchEvent | React.MouseEvent, shouldTriggerClick = true) => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        if (shouldTriggerClick && !isLongPressRef.current && onClick) {
            onClick();
        }
    }, [onClick]);

    const cancel = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }, []);

    return {
        onMouseDown: start,
        onMouseUp: (e: React.MouseEvent) => clear(e),
        onMouseLeave: (e: React.MouseEvent) => clear(e, false),
        onTouchStart: start,
        onTouchEnd: (e: React.TouchEvent) => clear(e),
        onTouchCancel: cancel
    };
};

// Message Item Wrapper with long press support
interface MessageItemWrapperProps {
    children: React.ReactNode;
    onLongPress: () => void;
    onClick?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    className?: string;
    selectMode?: boolean;
}

const MessageItemWrapper: React.FC<MessageItemWrapperProps> = ({
    children,
    onLongPress,
    onClick,
    onContextMenu,
    className,
    selectMode
}) => {
    const longPressHandlers = useLongPress(onLongPress, onClick, { delay: 500 });

    return (
        <div
            className={className}
            onContextMenu={onContextMenu}
            {...(selectMode ? { onClick } : longPressHandlers)}
        >
            {children}
        </div>
    );
};

// Conversation Item Wrapper with long press support
interface ConversationItemWrapperProps {
    children: React.ReactNode;
    onLongPress: () => void;
    onClick?: () => void;
    className?: string;
    selectMode?: boolean;
}

const ConversationItemWrapper: React.FC<ConversationItemWrapperProps> = ({
    children,
    onLongPress,
    onClick,
    className,
    selectMode
}) => {
    const longPressHandlers = useLongPress(onLongPress, onClick, { delay: 500 });

    return (
        <div
            className={className}
            {...(selectMode ? { onClick } : longPressHandlers)}
        >
            {children}
        </div>
    );
};

const ChatPage: React.FC = () => {
    const { socket, isConnected, onlineUsers, joinConversation, leaveConversation, sendTypingStart, sendTypingStop } = useSocket();
    const { adminUser } = useAuth();

    const currentUserId = useMemo(() => adminUser?._id || '', [adminUser]);

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [pendingConversations, setPendingConversations] = useState<PendingConversation[]>([]);
    const [selectedConversation, setSelectedConversation] = useState<DisplayConversation | null>(null);
    const [messageGroups, setMessageGroups] = useState<MessageGroup[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());

    // New conversation modal state
    const [showNewChatModal, setShowNewChatModal] = useState(false);
    const [userSearchQuery, setUserSearchQuery] = useState('');
    const [userSearchResults, setUserSearchResults] = useState<AdminUserData[]>([]);
    const [userSearchLoading, setUserSearchLoading] = useState(false);
    const [sendingFirstMessage, setSendingFirstMessage] = useState(false);
    const [userSearchFilter, setUserSearchFilter] = useState<'all' | 'active' | 'blocked' | 'deleted'>('all');
    // User-like filters (country, profession, interests)
    const [countryFilter, setCountryFilter] = useState('');
    const [professionFilter, setProfessionFilter] = useState('');
    const [interestsFilter, setInterestsFilter] = useState('');
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    // User info modal state
    const [showUserInfoModal, setShowUserInfoModal] = useState(false);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

    // Reply state
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);

    // Selection mode states
    const [messageSelectMode, setMessageSelectMode] = useState(false);
    const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
    const [conversationSelectMode, setConversationSelectMode] = useState(false);
    const [selectedConversationsSet, setSelectedConversationsSet] = useState<Set<string>>(new Set());

    // Forward modal state
    const [showForwardModal, setShowForwardModal] = useState(false);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; messageId: string } | null>(null);

    // Confirmation modal state
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        warningMessage?: string;
        onConfirm: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => {}
    });

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const allConversations = useMemo(() => {
        return [...pendingConversations, ...conversations] as DisplayConversation[];
    }, [conversations, pendingConversations]);

    // Flatten message groups into a single array for operations that need all messages
    const messages = useMemo(() => {
        return messageGroups.flatMap(group => group.messages);
    }, [messageGroups]);

    // Helper function to add a message to the correct date group
    const addMessageToGroups = useCallback((message: Message) => {
        const messageDate = new Date(message.createdAt);
        messageDate.setHours(0, 0, 0, 0);
        const dateKey = messageDate.toISOString().split('T')[0];

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        let dateLabel: string;
        if (messageDate.getTime() === today.getTime()) {
            dateLabel = 'Aujourd’hui';
        } else if (messageDate.getTime() === yesterday.getTime()) {
            dateLabel = 'Hier';
        } else {
            dateLabel = messageDate.toLocaleDateString('fr-FR', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        }

        setMessageGroups(prev => {
            const existingGroupIndex = prev.findIndex(g => g.date === dateKey);
            if (existingGroupIndex >= 0) {
                // Add to existing group
                const updated = [...prev];
                updated[existingGroupIndex] = {
                    ...updated[existingGroupIndex],
                    messages: [...updated[existingGroupIndex].messages, message]
                };
                return updated;
            } else {
                // Create new group
                return [...prev, {
                    date: dateKey,
                    dateLabel,
                    messages: [message]
                }].sort((a, b) => a.date.localeCompare(b.date));
            }
        });
    }, []);

    // Load conversations
    useEffect(() => {
        const loadConversations = async () => {
            try {
                const response = await getConversations();
                setConversations(response.data);
            } catch (error) {
                console.error('Failed to load conversations:', error);
            } finally {
                setLoading(false);
            }
        };
        loadConversations();
    }, []);

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
                            lastMessage: {
                                content: message.content,
                                senderId: message.senderId,
                                createdAt: message.createdAt
                            },
                            lastMessageAt: message.createdAt,
                            unreadCount: selectedConversation?._id === conv._id ? 0 : conv.unreadCount + 1
                        };
                    }
                    return conv;
                });
                return updated.sort((a, b) => {
                    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
                    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
                    return bTime - aTime;
                });
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
                        status: 'read' as const
                    }))
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

    // Load messages when conversation selected
    useEffect(() => {
        if (!selectedConversation) return;

        // Reset selection mode when changing conversations
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
                    conv._id === selectedConversation._id ? { ...conv, unreadCount: 0 } : conv
                ));
            } catch (error) {
                console.error('Failed to load messages:', error);
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

    // Close context menu on click outside
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    const scrollToBottom = () => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    };

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
                    lastMessageAt: message.createdAt
                };

                setConversations(prev => {
                    const exists = prev.find(c => c._id === realConversation._id);
                    if (exists) {
                        const updated = prev.map(c => c._id === realConversation._id ? updatedConversation : c);
                        return updated.sort((a, b) => {
                            const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
                            const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
                            return bTime - aTime;
                        });
                    }
                    return [updatedConversation, ...prev];
                });

                setSelectedConversation(updatedConversation);
                addMessageToGroups(message);
                joinConversation(realConversation._id);
                setSendingFirstMessage(false);
            } else {
                const message = await sendMessageApi(selectedConversation._id, messageContent, replyToId);
                addMessageToGroups(message);
                sendTypingStop(selectedConversation._id);

                setConversations(prev => {
                    const updated = prev.map(conv => {
                        if (conv._id === selectedConversation._id) {
                            return {
                                ...conv,
                                lastMessage: { content: message.content, senderId: message.senderId, createdAt: message.createdAt },
                                lastMessageAt: message.createdAt
                            };
                        }
                        return conv;
                    });
                    return updated.sort((a, b) => {
                        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
                        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
                        return bTime - aTime;
                    });
                });
            }
            scrollToBottom();
        } catch (error) {
            console.error('Failed to send message:', error);
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

    const getOtherParticipant = (conversation: DisplayConversation) => {
        return conversation.participants.find(p => p._id !== currentUserId) || conversation.participants[0];
    };

    const handleAvatarClick = (userId: string) => {
        setSelectedUserId(userId);
        setShowUserInfoModal(true);
    };

    const formatTime = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return 'Hier';
        } else if (diffDays < 7) {
            return date.toLocaleDateString('fr-FR', { weekday: 'short' });
        }
        return date.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' });
    };

    const filteredConversations = allConversations.filter(conv => {
        if (!searchQuery) return true;
        const otherParticipant = getOtherParticipant(conv);
        return otherParticipant.name.toLowerCase().includes(searchQuery.toLowerCase());
    });

    // Message actions
    const handleReply = (message: Message) => {
        setReplyingTo(message);
        setContextMenu(null);
        inputRef.current?.focus();
    };

    const handleCopyMessage = (message: Message) => {
        navigator.clipboard.writeText(message.content);
        setContextMenu(null);
    };

    const handleDeleteMessage = (messageId: string) => {
        setConfirmModal({
            isOpen: true,
            title: 'Supprimer le message',
            message: 'Voulez-vous vraiment supprimer ce message ?',
            warningMessage: 'Cette action est irréversible.',
            onConfirm: async () => {
                try {
                    await deleteMessageApi(messageId);
                    setMessageGroups(prev => prev.map(group => ({
                        ...group,
                        messages: group.messages.filter(m => m._id !== messageId)
                    })).filter(group => group.messages.length > 0));
                } catch (error) {
                    console.error('Failed to delete message:', error);
                }
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
            }
        });
        setContextMenu(null);
    };

    const handleDeleteSelectedMessages = () => {
        if (selectedMessages.size === 0) return;
        const count = selectedMessages.size;
        setConfirmModal({
            isOpen: true,
            title: 'Supprimer les messages',
            message: `Voulez-vous vraiment supprimer ${count} message${count > 1 ? 's' : ''} ?`,
            warningMessage: 'Cette action est irréversible : les messages sélectionnés seront définitivement supprimés.',
            onConfirm: async () => {
                try {
                    await deleteMessagesApi(Array.from(selectedMessages));
                    setMessageGroups(prev => prev.map(group => ({
                        ...group,
                        messages: group.messages.filter(m => !selectedMessages.has(m._id))
                    })).filter(group => group.messages.length > 0));
                    setSelectedMessages(new Set());
                    setMessageSelectMode(false);
                } catch (error) {
                    console.error('Failed to delete messages:', error);
                }
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const handleCopySelectedMessages = () => {
        const selectedMsgs = messages.filter(m => selectedMessages.has(m._id));
        const text = selectedMsgs.map(m => m.content).join('\n');
        navigator.clipboard.writeText(text);
        setSelectedMessages(new Set());
        setMessageSelectMode(false);
    };

    const handleForwardSelectedMessages = () => {
        if (selectedMessages.size > 0) {
            setShowForwardModal(true);
        }
    };

    const handleForward = async (targetConversationIds: string[]) => {
        try {
            // Get the content of forwarded messages for updating UI
            const forwardedMessageContent = messages.find(m => selectedMessages.has(m._id))?.content || 'Message transféré';

            await forwardMessagesApi(Array.from(selectedMessages), targetConversationIds);

            // Update conversations list to reflect the forwarded messages
            setConversations(prev => {
                const updated = prev.map(conv => {
                    if (targetConversationIds.includes(conv._id)) {
                        return {
                            ...conv,
                            lastMessage: {
                                content: forwardedMessageContent,
                                senderId: currentUserId,
                                createdAt: new Date().toISOString()
                            },
                            lastMessageAt: new Date().toISOString()
                        };
                    }
                    return conv;
                });
                // Sort by lastMessageAt
                return updated.sort((a, b) => {
                    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
                    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
                    return bTime - aTime;
                });
            });

            // If we forwarded to the current conversation, reload its messages
            if (selectedConversation && targetConversationIds.includes(selectedConversation._id)) {
                const response = await getMessagesGrouped(selectedConversation._id);
                setMessageGroups(response.data);
                scrollToBottom();
            }

            setSelectedMessages(new Set());
            setMessageSelectMode(false);
            setShowForwardModal(false);
        } catch (error) {
            console.error('Failed to forward messages:', error);
        }
    };

    const toggleMessageSelection = (messageId: string) => {
        const newSelected = new Set(selectedMessages);
        if (newSelected.has(messageId)) {
            newSelected.delete(messageId);
        } else {
            newSelected.add(messageId);
        }
        setSelectedMessages(newSelected);
    };

    // Conversation actions
    const handleDeleteConversation = (conversationId: string) => {
        setConfirmModal({
            isOpen: true,
            title: 'Supprimer la conversation',
            message: 'Voulez-vous vraiment supprimer cette conversation ?',
            warningMessage: 'Tous ses messages seront supprimés. Cette action est irréversible.',
            onConfirm: async () => {
                try {
                    await deleteConversationApi(conversationId);
                    setConversations(prev => prev.filter(c => c._id !== conversationId));
                    if (selectedConversation?._id === conversationId) {
                        setSelectedConversation(null);
                    }
                } catch (error) {
                    console.error('Failed to delete conversation:', error);
                }
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const handleDeleteSelectedConversations = () => {
        if (selectedConversationsSet.size === 0) return;
        const count = selectedConversationsSet.size;
        setConfirmModal({
            isOpen: true,
            title: 'Supprimer les conversations',
            message: `Voulez-vous vraiment supprimer ${count} conversation${count > 1 ? 's' : ''} ?`,
            warningMessage: 'Tous leurs messages seront supprimés. Cette action est irréversible.',
            onConfirm: async () => {
                try {
                    await deleteConversationsApi(Array.from(selectedConversationsSet));
                    setConversations(prev => prev.filter(c => !selectedConversationsSet.has(c._id)));
                    if (selectedConversation && selectedConversationsSet.has(selectedConversation._id)) {
                        setSelectedConversation(null);
                    }
                    setSelectedConversationsSet(new Set());
                    setConversationSelectMode(false);
                } catch (error) {
                    console.error('Failed to delete conversations:', error);
                }
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const toggleConversationSelection = (conversationId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newSelected = new Set(selectedConversationsSet);
        if (newSelected.has(conversationId)) {
            newSelected.delete(conversationId);
        } else {
            newSelected.add(conversationId);
        }
        setSelectedConversationsSet(newSelected);
    };

    // Context menu handler
    const handleMessageContextMenu = (e: React.MouseEvent, messageId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, messageId });
    };

    // Search users for new conversation
    const handleUserSearch = async (
        query: string,
        statusFilter: typeof userSearchFilter = userSearchFilter,
        country: string = countryFilter,
        profession: string = professionFilter,
        interests: string = interestsFilter
    ) => {
        setUserSearchQuery(query);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        // Need either search query OR at least one advanced filter
        const hasAdvancedFilters = country.trim() || profession.trim() || interests.trim();
        if (query.trim().length < 2 && !hasAdvancedFilters) {
            setUserSearchResults([]);
            return;
        }

        searchTimeoutRef.current = setTimeout(async () => {
            setUserSearchLoading(true);
            try {
                const filters: {
                    search?: string;
                    status?: 'active' | 'blocked' | 'deleted';
                    country?: string;
                    profession?: string;
                    interests?: string[];
                } = {};

                if (query.trim().length >= 2) filters.search = query;
                if (statusFilter !== 'all') filters.status = statusFilter;
                if (country.trim()) filters.country = country.trim();
                if (profession.trim()) filters.profession = profession.trim();
                if (interests.trim()) {
                    filters.interests = interests.split(',').map(i => i.trim()).filter(i => i.length > 0);
                }

                const response = await listUsers(filters, { page: 1, limit: 20 });
                setUserSearchResults(response.data);
            } catch (error) {
                console.error('Failed to search users:', error);
            } finally {
                setUserSearchLoading(false);
            }
        }, 300);
    };

    const handleFilterChange = (newFilter: typeof userSearchFilter) => {
        setUserSearchFilter(newFilter);
        handleUserSearch(userSearchQuery, newFilter, countryFilter, professionFilter, interestsFilter);
    };

    const handleAdvancedFilterChange = (
        country: string = countryFilter,
        profession: string = professionFilter,
        interests: string = interestsFilter
    ) => {
        setCountryFilter(country);
        setProfessionFilter(profession);
        setInterestsFilter(interests);
        handleUserSearch(userSearchQuery, userSearchFilter, country, profession, interests);
    };

    const clearAllFilters = () => {
        setUserSearchFilter('all');
        setCountryFilter('');
        setProfessionFilter('');
        setInterestsFilter('');
        setUserSearchQuery('');
        setUserSearchResults([]);
    };

    const handleStartConversation = (user: AdminUserData) => {
        const existingConversation = conversations.find(c => c.participants.some(p => p._id === user._id));

        if (existingConversation) {
            setSelectedConversation(existingConversation);
        } else {
            const existingPending = pendingConversations.find(p => p.pendingUser._id === user._id);
            if (existingPending) {
                setSelectedConversation(existingPending);
            } else {
                const pendingConv: PendingConversation = {
                    isPending: true,
                    pendingUser: user,
                    _id: `pending_${user._id}`,
                    participants: [
                        { _id: currentUserId, name: adminUser?.name || 'Admin', avatar: adminUser?.avatar },
                        { _id: user._id, name: user.name, avatar: user.avatar }
                    ],
                    unreadCount: 0
                };
                setPendingConversations(prev => [pendingConv, ...prev]);
                setSelectedConversation(pendingConv);
            }
        }

        setShowNewChatModal(false);
        setUserSearchQuery('');
        setUserSearchResults([]);
    };

    return (
        <div className="flex h-[calc(100dvh-145px)] md:h-[calc(100dvh-104px)]">
            {/* Conversation List */}
            <div className={`w-full md:w-80 lg:w-96 border-r border-line flex flex-col ${selectedConversation ? 'hidden md:flex' : 'flex'}`}>
                {/* Header */}
                <div className="p-4 border-b border-line">
                    <div className="flex items-center justify-between mb-4">
                        <h1 className="text-xl font-bold text-fg flex items-center gap-2">
                            <MessageCircle className="w-6 h-6 text-indigo-500" />
                            Messages
                            {isConnected && <span className="w-2 h-2 bg-green-500 rounded-full ml-2" title="Connecté" />}
                        </h1>
                        <div className="flex items-center gap-2">
                            {conversationSelectMode ? (
                                <>
                                    <button
                                        onClick={handleDeleteSelectedConversations}
                                        disabled={selectedConversationsSet.size === 0}
                                        className="p-2 bg-red-600 text-white rounded-full hover:bg-red-700 disabled:opacity-50 transition-colors"
                                        title="Supprimer la sélection"
                                    >
                                        <Trash2 className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => { setConversationSelectMode(false); setSelectedConversationsSet(new Set()); }}
                                        className="p-2 bg-surface-3 text-fg rounded-full hover:bg-line-strong transition-colors"
                                        title="Annuler"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        onClick={() => setConversationSelectMode(true)}
                                        className="p-2 text-fg-muted hover:text-fg hover:bg-surface-2 rounded-full transition-colors"
                                        title="Sélectionner des conversations"
                                    >
                                        <CheckSquare className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => setShowNewChatModal(true)}
                                        className="p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-colors"
                                        title="Nouvelle conversation"
                                    >
                                        <Plus className="w-5 h-5" />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-fg-muted" />
                        <input
                            type="text"
                            placeholder="Rechercher une conversation"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-surface border border-line-strong rounded-lg text-fg placeholder-fg-subtle focus:outline-hidden focus:border-indigo-500"
                        />
                    </div>
                    {conversationSelectMode && selectedConversationsSet.size > 0 && (
                        <p className="text-sm text-indigo-600 dark:text-indigo-400 mt-2">{selectedConversationsSet.size} sélectionnée{selectedConversationsSet.size > 1 ? 's' : ''}</p>
                    )}
                </div>

                {/* Conversation List */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center h-32">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
                        </div>
                    ) : filteredConversations.length === 0 ? (
                        <div className="text-center text-fg-muted py-8">Aucune conversation</div>
                    ) : (
                        filteredConversations.map(conversation => {
                            const otherParticipant = getOtherParticipant(conversation);
                            const isOnline = onlineUsers.has(otherParticipant._id);
                            const isSelected = selectedConversation?._id === conversation._id;
                            const isChecked = selectedConversationsSet.has(conversation._id);

                            // Long press handler to enter selection mode
                            const handleLongPressConversation = () => {
                                if (!conversationSelectMode && !isPendingConversation(conversation)) {
                                    setConversationSelectMode(true);
                                    setSelectedConversationsSet(new Set([conversation._id]));
                                }
                            };

                            // Click handler
                            const handleConversationClick = () => {
                                if (conversationSelectMode) {
                                    if (!isPendingConversation(conversation)) {
                                        const newSelected = new Set(selectedConversationsSet);
                                        if (newSelected.has(conversation._id)) {
                                            newSelected.delete(conversation._id);
                                        } else {
                                            newSelected.add(conversation._id);
                                        }
                                        setSelectedConversationsSet(newSelected);
                                    }
                                } else {
                                    setSelectedConversation(conversation);
                                }
                            };

                            return (
                                <ConversationItemWrapper
                                    key={conversation._id}
                                    onLongPress={handleLongPressConversation}
                                    onClick={handleConversationClick}
                                    className={`group flex items-center gap-3 p-4 cursor-pointer border-b border-line hover:bg-surface-2 transition-colors ${isSelected ? 'bg-surface-2' : ''} ${isChecked ? 'bg-indigo-100 dark:bg-indigo-900/30' : ''}`}
                                    selectMode={conversationSelectMode}
                                >
                                    {conversationSelectMode && (
                                        <button
                                            onClick={(e) => toggleConversationSelection(conversation._id, e)}
                                            className={`w-5 h-5 rounded-sm border-2 flex items-center justify-center shrink-0 ${isChecked ? 'bg-indigo-600 border-indigo-600' : 'border-line-strong'}`}
                                        >
                                            {isChecked && <Check className="w-3 h-3 text-white" />}
                                        </button>
                                    )}
                                    <div
                                        className="relative cursor-pointer"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (isPendingConversation(conversation)) {
                                                handleAvatarClick(conversation.pendingUser._id);
                                            } else {
                                                handleAvatarClick(otherParticipant._id);
                                            }
                                        }}
                                    >
                                        <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center text-white font-semibold overflow-hidden hover:ring-2 hover:ring-indigo-400 transition-all">
                                            {otherParticipant.avatar ? (
                                                <img src={otherParticipant.avatar} alt={otherParticipant.name} className="w-full h-full rounded-full object-cover" />
                                            ) : (
                                                otherParticipant.name.charAt(0).toUpperCase()
                                            )}
                                        </div>
                                        {isOnline && <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center">
                                            <span className="font-medium text-fg truncate">
                                                {otherParticipant.name}
                                                {isPendingConversation(conversation) && <span className="ml-2 text-xs text-fg-subtle">(Brouillon)</span>}
                                            </span>
                                            {conversation.lastMessageAt && <span className="text-xs text-fg-muted">{formatTime(conversation.lastMessageAt)}</span>}
                                        </div>
                                        <div className="flex justify-between items-center mt-1">
                                            <p className="text-sm text-fg-muted truncate">
                                                {isPendingConversation(conversation) ? 'Cliquez pour démarrer la conversation' : (conversation.lastMessage?.content || 'Aucun message')}
                                            </p>
                                            {conversation.unreadCount > 0 && (
                                                <span className="bg-indigo-500 text-white text-xs rounded-full px-2 py-0.5 ml-2">{conversation.unreadCount}</span>
                                            )}
                                        </div>
                                    </div>
                                    {!conversationSelectMode && !isPendingConversation(conversation) && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conversation._id); }}
                                            className="p-1 text-fg-subtle hover:text-red-700 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Supprimer la conversation"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </ConversationItemWrapper>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Message Area */}
            <div className={`flex-1 flex flex-col ${!selectedConversation ? 'hidden md:flex' : 'flex'}`}>
                {selectedConversation ? (
                    <>
                        {/* Chat Header */}
                        <div className="p-4 border-b border-line flex items-center gap-3">
                            <button onClick={() => setSelectedConversation(null)} className="md:hidden text-fg-muted hover:text-fg">
                                <ArrowLeft className="w-6 h-6" />
                            </button>
                            <div
                                className="relative cursor-pointer"
                                onClick={() => {
                                    if (isPendingConversation(selectedConversation)) {
                                        handleAvatarClick(selectedConversation.pendingUser._id);
                                    } else {
                                        handleAvatarClick(getOtherParticipant(selectedConversation)._id);
                                    }
                                }}
                            >
                                <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white font-semibold overflow-hidden hover:ring-2 hover:ring-indigo-400 transition-all">
                                    {getOtherParticipant(selectedConversation).avatar ? (
                                        <img src={getOtherParticipant(selectedConversation).avatar} alt={getOtherParticipant(selectedConversation).name} className="w-full h-full rounded-full object-cover" />
                                    ) : (
                                        getOtherParticipant(selectedConversation).name.charAt(0).toUpperCase()
                                    )}
                                </div>
                                {onlineUsers.has(getOtherParticipant(selectedConversation)._id) && (
                                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
                                )}
                            </div>
                            <div className="flex-1">
                                <h2 className="font-medium text-fg">
                                    {getOtherParticipant(selectedConversation).name}
                                    {isPendingConversation(selectedConversation) && <span className="ml-2 text-xs text-fg-subtle">(Brouillon)</span>}
                                </h2>
                                <p className="text-sm text-fg-muted">
                                    {isPendingConversation(selectedConversation) ? 'Envoyez un message pour démarrer la conversation' : (onlineUsers.has(getOtherParticipant(selectedConversation)._id) ? 'En ligne' : 'Hors ligne')}
                                </p>
                            </div>
                            {messageSelectMode ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-indigo-600 dark:text-indigo-400">{selectedMessages.size} sélectionné{selectedMessages.size > 1 ? 's' : ''}</span>
                                    <button onClick={handleCopySelectedMessages} disabled={selectedMessages.size === 0} className="p-2 text-fg-muted hover:text-fg disabled:opacity-50" title="Copier">
                                        <Copy className="w-5 h-5" />
                                    </button>
                                    <button onClick={handleForwardSelectedMessages} disabled={selectedMessages.size === 0} className="p-2 text-fg-muted hover:text-fg disabled:opacity-50" title="Transférer">
                                        <Forward className="w-5 h-5" />
                                    </button>
                                    <button onClick={handleDeleteSelectedMessages} disabled={selectedMessages.size === 0} className="p-2 text-fg-muted hover:text-red-700 dark:hover:text-red-400 disabled:opacity-50" title="Supprimer">
                                        <Trash2 className="w-5 h-5" />
                                    </button>
                                    <button onClick={() => { setMessageSelectMode(false); setSelectedMessages(new Set()); }} className="p-2 text-fg-muted hover:text-fg" title="Annuler">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setMessageSelectMode(true)} className="p-2 text-fg-muted hover:text-fg" title="Sélectionner des messages">
                                        <CheckSquare className="w-5 h-5" />
                                    </button>
                                    <button className="text-fg-muted hover:text-fg" aria-label="Plus d’actions">
                                        <MoreVertical className="w-5 h-5" />
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {messagesLoading ? (
                                <div className="flex items-center justify-center h-32">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
                                </div>
                            ) : messageGroups.length === 0 ? (
                                <div className="text-center text-fg-muted py-8">Aucun message. Démarrez la conversation.</div>
                            ) : (
                                messageGroups.map(group => (
                                    <div key={group.date}>
                                        {/* Date Separator */}
                                        <div className="flex items-center justify-center my-4">
                                            <div className="px-3 py-1 bg-surface-2/50 rounded-full text-xs text-fg-muted font-medium">
                                                {group.dateLabel}
                                            </div>
                                        </div>

                                        {/* Messages in this date group */}
                                        {group.messages.map(message => {
                                    const isMine = message.senderId === currentUserId;
                                    const isMessageSelected = selectedMessages.has(message._id);

                                    // Long press handler to enter selection mode
                                    const handleLongPressMessage = () => {
                                        if (!messageSelectMode) {
                                            setMessageSelectMode(true);
                                            setSelectedMessages(new Set([message._id]));
                                        }
                                    };

                                    // Click handler for selection or normal click
                                    const handleMessageClick = () => {
                                        if (messageSelectMode) {
                                            toggleMessageSelection(message._id);
                                        }
                                    };

                                    return (
                                        <MessageItemWrapper
                                            key={message._id}
                                            onLongPress={handleLongPressMessage}
                                            onClick={handleMessageClick}
                                            onContextMenu={(e) => !messageSelectMode && handleMessageContextMenu(e, message._id)}
                                            className={`flex ${isMine ? 'justify-end' : 'justify-start'} ${isMessageSelected ? 'bg-indigo-50 dark:bg-indigo-900/20 -mx-4 px-4 py-1 rounded-sm' : ''}`}
                                            selectMode={messageSelectMode}
                                        >
                                            {messageSelectMode && (
                                                <button className={`w-5 h-5 rounded-sm border-2 flex items-center justify-center shrink-0 mr-2 self-center ${isMessageSelected ? 'bg-indigo-600 border-indigo-600' : 'border-line-strong'}`}>
                                                    {isMessageSelected && <Check className="w-3 h-3 text-white" />}
                                                </button>
                                            )}
                                            <div className={`max-w-[70%] ${isMine ? 'order-2' : 'order-1'}`}>
                                                {/* Reply preview */}
                                                {message.replyTo && (
                                                    <div className={`text-xs px-3 py-1 mb-1 rounded-t-lg border-l-2 ${isMine ? 'bg-indigo-100 dark:bg-indigo-700/50 border-indigo-400' : 'bg-surface-3/50 border-gray-400'}`}>
                                                        <p className="text-fg-muted font-medium">{message.replyTo.senderName || 'Utilisateur'}</p>
                                                        <p className="text-fg-muted truncate">{message.replyTo.content}</p>
                                                    </div>
                                                )}
                                                <div className={`px-4 py-2 rounded-2xl ${isMine ? 'bg-indigo-600 text-white rounded-br-md' : 'bg-surface-2 text-fg rounded-bl-md'}`}>
                                                    {message.type === 'document' ? (
                                                        <a href={message.documentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:underline">
                                                            <Paperclip className="w-4 h-4" />
                                                            {message.documentName || 'Document'}
                                                        </a>
                                                    ) : (
                                                        <p>{message.content}</p>
                                                    )}
                                                </div>
                                                <div className={`flex items-center gap-1 mt-1 text-xs text-fg-subtle ${isMine ? 'justify-end' : 'justify-start'}`}>
                                                    <span>{formatTime(message.createdAt)}</span>
                                                    {isMine && (
                                                        message.status === 'read' ? <CheckCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" /> :
                                                        message.status === 'delivered' ? <CheckCheck className="w-4 h-4" /> :
                                                        <Check className="w-4 h-4" />
                                                    )}
                                                </div>
                                            </div>
                                        </MessageItemWrapper>
                                    );
                                        })}
                                    </div>
                                ))
                            )}

                            {/* Typing indicator */}
                            {typingUsers.size > 0 && (
                                <div className="flex items-center gap-2 text-fg-muted text-sm">
                                    <div className="flex gap-1">
                                        <Circle className="w-2 h-2 animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <Circle className="w-2 h-2 animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <Circle className="w-2 h-2 animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </div>
                                    <span>{Array.from(typingUsers.values()).join(', ')} {typingUsers.size > 1 ? 'écrivent' : 'écrit'}…</span>
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>

                        {/* Reply preview */}
                        {replyingTo && (
                            <div className="px-4 py-2 bg-surface border-t border-line flex items-center gap-3">
                                <div className="flex-1 border-l-2 border-indigo-500 pl-3">
                                    <p className="text-xs text-indigo-600 dark:text-indigo-400">{replyingTo.senderId === currentUserId ? 'Réponse à votre message' : 'Réponse au message'}</p>
                                    <p className="text-sm text-fg-muted truncate">{replyingTo.content}</p>
                                </div>
                                <button onClick={() => setReplyingTo(null)} className="text-fg-muted hover:text-fg">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        )}

                        {/* Message Input */}
                        <form onSubmit={handleSendMessage} className="p-4 border-t border-line">
                            <div className="flex items-center gap-3">
                                <button type="button" className="text-fg-muted hover:text-fg" title="Joindre un document">
                                    <Paperclip className="w-5 h-5" />
                                </button>
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={newMessage}
                                    onChange={handleTyping}
                                    placeholder="Écrire un message…"
                                    className="flex-1 px-4 py-2 bg-surface border border-line-strong rounded-full text-fg placeholder-fg-subtle focus:outline-hidden focus:border-indigo-500"
                                />
                                <button
                                    type="submit"
                                    disabled={!newMessage.trim() || sendingFirstMessage}
                                    className="p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {sendingFirstMessage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                                </button>
                            </div>
                        </form>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-fg-muted">
                        <div className="text-center">
                            <MessageCircle className="w-16 h-16 mx-auto mb-4 opacity-50" />
                            <p className="text-lg">Sélectionnez une conversation pour écrire</p>
                            <button
                                onClick={() => setShowNewChatModal(true)}
                                className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 mx-auto"
                            >
                                <Plus className="w-4 h-4" />
                                Nouvelle conversation
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed bg-surface rounded-lg border border-line py-1 z-50"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => { const msg = messages.find(m => m._id === contextMenu.messageId); if (msg) handleReply(msg); }}
                        className="w-full px-4 py-2 text-left text-fg hover:bg-surface-2 flex items-center gap-2"
                    >
                        <Reply className="w-4 h-4" /> Répondre
                    </button>
                    <button
                        onClick={() => { const msg = messages.find(m => m._id === contextMenu.messageId); if (msg) handleCopyMessage(msg); }}
                        className="w-full px-4 py-2 text-left text-fg hover:bg-surface-2 flex items-center gap-2"
                    >
                        <Copy className="w-4 h-4" /> Copier
                    </button>
                    <button
                        onClick={() => { setSelectedMessages(new Set([contextMenu.messageId])); setShowForwardModal(true); setContextMenu(null); }}
                        className="w-full px-4 py-2 text-left text-fg hover:bg-surface-2 flex items-center gap-2"
                    >
                        <Forward className="w-4 h-4" /> Transférer
                    </button>
                    <button
                        onClick={() => handleDeleteMessage(contextMenu.messageId)}
                        className="w-full px-4 py-2 text-left text-red-600 dark:text-red-400 hover:bg-surface-2 flex items-center gap-2"
                    >
                        <Trash2 className="w-4 h-4" /> Supprimer
                    </button>
                </div>
            )}

            {/* New Conversation Modal */}
            {showNewChatModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-surface rounded-lg w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
                        <div className="p-4 border-b border-line flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-fg">Nouvelle conversation</h2>
                            <button onClick={() => { setShowNewChatModal(false); clearAllFilters(); }} className="text-fg-muted hover:text-fg">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-4 border-b border-line">
                            {/* Search input */}
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-fg-muted" />
                                <input
                                    type="text"
                                    placeholder="Rechercher par nom ou e-mail"
                                    value={userSearchQuery}
                                    onChange={(e) => handleUserSearch(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2 bg-surface border border-line-strong rounded-lg text-fg placeholder-fg-subtle focus:outline-hidden focus:border-indigo-500"
                                    autoFocus
                                />
                            </div>

                            {/* Admin status filters */}
                            <div className="flex flex-wrap gap-2 mt-3">
                                <span className="text-xs text-fg-subtle flex items-center gap-1">
                                    <Shield className="w-3 h-3" /> Statut :
                                </span>
                                {(['all', 'active', 'blocked', 'deleted'] as const).map(filter => (
                                    <button
                                        key={filter}
                                        onClick={() => handleFilterChange(filter)}
                                        className={`px-3 py-1 text-xs rounded-full transition-colors ${
                                            userSearchFilter === filter
                                                ? filter === 'all' ? 'bg-indigo-600 text-white' :
                                                  filter === 'active' ? 'bg-green-600 text-white' :
                                                  filter === 'blocked' ? 'bg-red-600 text-white' :
                                                  'bg-gray-500 text-white'
                                                : 'bg-surface-2 text-fg-muted hover:bg-surface-3'
                                        }`}
                                    >
                                        {USER_FILTER_LABELS[filter]}
                                    </button>
                                ))}
                            </div>

                            {/* Advanced filters toggle */}
                            <button
                                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                                className="w-full mt-3 flex items-center justify-between py-2 px-3 bg-surface-2/50 rounded-lg text-fg-muted hover:bg-surface-2 transition-colors"
                            >
                                <span className="flex items-center gap-2 text-sm">
                                    <Filter className="w-4 h-4" />
                                    Filtres (pays, profession, centres d’intérêt)
                                    {(countryFilter || professionFilter || interestsFilter) && (
                                        <span className="px-1.5 py-0.5 bg-indigo-600 text-white text-xs rounded-full">Actifs</span>
                                    )}
                                </span>
                                {showAdvancedFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>

                            {/* Advanced filters panel */}
                            {showAdvancedFilters && (
                                <div className="mt-3 space-y-3 p-3 bg-surface-2/30 rounded-lg">
                                    {/* Country filter */}
                                    <div>
                                        <label className="flex items-center gap-2 text-xs text-fg-muted mb-1">
                                            <Globe className="w-3 h-3" /> Pays
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="ex. : CM, Cameroun…"
                                            value={countryFilter}
                                            onChange={(e) => handleAdvancedFilterChange(e.target.value, professionFilter, interestsFilter)}
                                            className="w-full px-3 py-1.5 bg-surface border border-line-strong rounded-sm text-fg text-sm placeholder-fg-subtle focus:outline-hidden focus:border-indigo-500"
                                        />
                                    </div>

                                    {/* Profession filter */}
                                    <div>
                                        <label className="flex items-center gap-2 text-xs text-fg-muted mb-1">
                                            <Briefcase className="w-3 h-3" /> Profession
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="ex. : ingénieur, enseignant…"
                                            value={professionFilter}
                                            onChange={(e) => handleAdvancedFilterChange(countryFilter, e.target.value, interestsFilter)}
                                            className="w-full px-3 py-1.5 bg-surface border border-line-strong rounded-sm text-fg text-sm placeholder-fg-subtle focus:outline-hidden focus:border-indigo-500"
                                        />
                                    </div>

                                    {/* Interests filter */}
                                    <div>
                                        <label className="flex items-center gap-2 text-xs text-fg-muted mb-1">
                                            <Heart className="w-3 h-3" /> Centres d’intérêt (séparés par des virgules)
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="ex. : football, musique, tech…"
                                            value={interestsFilter}
                                            onChange={(e) => handleAdvancedFilterChange(countryFilter, professionFilter, e.target.value)}
                                            className="w-full px-3 py-1.5 bg-surface border border-line-strong rounded-sm text-fg text-sm placeholder-fg-subtle focus:outline-hidden focus:border-indigo-500"
                                        />
                                    </div>

                                    {/* Clear filters button */}
                                    {(countryFilter || professionFilter || interestsFilter) && (
                                        <button
                                            onClick={() => handleAdvancedFilterChange('', '', '')}
                                            className="w-full py-1.5 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                                        >
                                            Effacer les filtres
                                        </button>
                                    )}
                                </div>
                            )}

                            <p className="text-xs text-fg-subtle mt-2">
                                {(countryFilter || professionFilter || interestsFilter)
                                    ? 'Recherche avec filtres…'
                                    : 'Tapez au moins 2 caractères ou utilisez les filtres'}
                            </p>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {userSearchLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                                </div>
                            ) : userSearchResults.length === 0 ? (
                                <div className="text-center text-fg-muted py-8">
                                    {(userSearchQuery.length >= 2 || countryFilter || professionFilter || interestsFilter)
                                        ? 'Aucun utilisateur trouvé'
                                        : 'Recherchez un utilisateur ou appliquez des filtres'}
                                </div>
                            ) : (
                                userSearchResults.map(user => (
                                    <button
                                        key={user._id}
                                        onClick={() => handleStartConversation(user)}
                                        className="w-full flex items-center gap-3 p-4 hover:bg-surface-2 transition-colors text-left"
                                    >
                                        <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white font-semibold shrink-0 overflow-hidden">
                                            {user.avatar ? <img src={user.avatar} alt={user.name} className="w-full h-full rounded-full object-cover" /> : <User className="w-5 h-5" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-fg truncate">{user.name}</p>
                                            <p className="text-sm text-fg-muted truncate">{user.email}</p>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {user.country && (
                                                    <span className="text-xs text-fg-subtle flex items-center gap-1">
                                                        <Globe className="w-3 h-3" /> {user.country}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* User Info Modal */}
            <UserInfoModal
                userId={selectedUserId}
                isOpen={showUserInfoModal}
                onClose={() => { setShowUserInfoModal(false); setSelectedUserId(null); }}
            />

            {/* Forward Modal */}
            <ForwardModal
                isOpen={showForwardModal}
                onClose={() => setShowForwardModal(false)}
                conversations={conversations}
                onForward={handleForward}
                messageCount={selectedMessages.size}
            />

            {/* Confirmation Modal */}
            <ConfirmationModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                warningMessage={confirmModal.warningMessage}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
            />
        </div>
    );
};

export default ChatPage;
