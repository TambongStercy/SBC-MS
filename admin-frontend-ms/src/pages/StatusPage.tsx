import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';
import {
    getStatusFeed,
    getCategories,
    createStatus,
    likeStatus as likeStatusApi,
    unlikeStatus as unlikeStatusApi,
    deleteStatus,
    Status,
    StatusCategory,
    StatusFilters
} from '../services/statusApi';
import {
    Heart,
    X,
    Image,
    Video,
    Plus,
    ChevronLeft,
    ChevronRight,
    Trash2,
    Clock,
    MapPin,
    Send,
    Eye
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import ToastContainer from '../components/common/ToastContainer';
import ConfirmationModal from '../components/common/ConfirmationModal';

interface GroupedStatus {
    authorId: string;
    authorName: string;
    authorAvatar?: string;
    statuses: Status[];
    latestTime: Date;
    hasUnviewed: boolean;
}

const StatusPage: React.FC = () => {
    const { socket, subscribeToStatuses, unsubscribeFromStatuses, viewStatus } = useSocket();
    const { toasts, removeToast, showSuccess, showError } = useToast();

    const [statuses, setStatuses] = useState<Status[]>([]);
    const [groupedStatuses, setGroupedStatuses] = useState<GroupedStatus[]>([]);
    const [categories, setCategories] = useState<StatusCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [showComposer, setShowComposer] = useState(false);

    // Story viewer state
    const [viewingGroup, setViewingGroup] = useState<GroupedStatus | null>(null);
    const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
    const [storyProgress, setStoryProgress] = useState(0);
    const progressInterval = useRef<NodeJS.Timeout | null>(null);

    // Composer state
    const [newStatus, setNewStatus] = useState({
        category: '',
        content: '',
        media: null as File | null
    });
    const [composerLoading, setComposerLoading] = useState(false);

    // Confirmation modal state
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState<{
        title: string;
        message: string;
        onConfirm: () => void;
    } | null>(null);

    // Load categories
    useEffect(() => {
        const loadCategories = async () => {
            try {
                const cats = await getCategories();
                setCategories(cats);
            } catch (error) {
                console.error('Failed to load categories:', error);
                showError('Impossible de charger les catégories');
            }
        };
        loadCategories();
    }, []);

    // Load statuses
    const loadStatuses = useCallback(async () => {
        try {
            setLoading(true);
            // Load all statuses (stories expire after 24h, so we don't need pagination)
            const response = await getStatusFeed({}, 1, 100);
            setStatuses(response.data);
        } catch (error) {
            console.error('Failed to load statuses:', error);
            showError('Impossible de charger les stories');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadStatuses();
    }, [loadStatuses]);

    // Group statuses by author
    useEffect(() => {
        const groups = new Map<string, GroupedStatus>();

        statuses.forEach(status => {
            if (!status.author) return;

            const authorId = status.author._id;
            if (!groups.has(authorId)) {
                groups.set(authorId, {
                    authorId,
                    authorName: status.author.name,
                    authorAvatar: status.author.avatar,
                    statuses: [],
                    latestTime: new Date(status.createdAt),
                    hasUnviewed: false // TODO: Track viewed stories
                });
            }

            groups.get(authorId)!.statuses.push(status);
        });

        // Sort statuses within each group by time
        groups.forEach(group => {
            group.statuses.sort((a, b) =>
                new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
        });

        // Convert to array and sort by latest story
        const groupedArray = Array.from(groups.values()).sort((a, b) =>
            b.latestTime.getTime() - a.latestTime.getTime()
        );

        setGroupedStatuses(groupedArray);
    }, [statuses]);

    // Subscribe to status updates
    useEffect(() => {
        subscribeToStatuses();
        return () => unsubscribeFromStatuses();
    }, [subscribeToStatuses, unsubscribeFromStatuses]);

    // Socket event listeners
    useEffect(() => {
        if (!socket) return;

        const handleNewStatus = (status: Status) => {
            setStatuses(prev => [status, ...prev]);
        };

        const handleStatusLiked = ({ statusId, likesCount }: { statusId: string; likesCount: number }) => {
            setStatuses(prev => prev.map(s =>
                s._id === statusId ? { ...s, likesCount } : s
            ));
        };

        const handleStatusDeleted = ({ statusId }: { statusId: string }) => {
            setStatuses(prev => prev.filter(s => s._id !== statusId));
            // Close viewer if current story was deleted
            if (viewingGroup && viewingGroup.statuses[currentStoryIndex]?._id === statusId) {
                handleNextStory();
            }
        };

        socket.on('status:new', handleNewStatus);
        socket.on('status:liked', handleStatusLiked);
        socket.on('status:unliked', handleStatusLiked);
        socket.on('status:deleted', handleStatusDeleted);

        return () => {
            socket.off('status:new', handleNewStatus);
            socket.off('status:liked', handleStatusLiked);
            socket.off('status:unliked', handleStatusLiked);
            socket.off('status:deleted', handleStatusDeleted);
        };
    }, [socket, viewingGroup, currentStoryIndex]);

    // Story progress timer
    useEffect(() => {
        if (!viewingGroup) {
            if (progressInterval.current) {
                clearInterval(progressInterval.current);
                progressInterval.current = null;
            }
            return;
        }

        const duration = 5000; // 5 seconds per story
        const intervalTime = 50; // Update every 50ms
        const increment = (intervalTime / duration) * 100;

        progressInterval.current = setInterval(() => {
            setStoryProgress(prev => {
                const next = prev + increment;
                if (next >= 100) {
                    handleNextStory();
                    return 0;
                }
                return next;
            });
        }, intervalTime);

        return () => {
            if (progressInterval.current) {
                clearInterval(progressInterval.current);
                progressInterval.current = null;
            }
        };
    }, [viewingGroup, currentStoryIndex]);

    const openStoryViewer = (group: GroupedStatus, startIndex: number = 0) => {
        setViewingGroup(group);
        setCurrentStoryIndex(startIndex);
        setStoryProgress(0);

        // Mark as viewed
        if (group.statuses[startIndex]) {
            viewStatus(group.statuses[startIndex]._id);
        }
    };

    const closeStoryViewer = () => {
        setViewingGroup(null);
        setCurrentStoryIndex(0);
        setStoryProgress(0);
    };

    const handleNextStory = () => {
        if (!viewingGroup) return;

        if (currentStoryIndex < viewingGroup.statuses.length - 1) {
            // Next story in same group
            const nextIndex = currentStoryIndex + 1;
            setCurrentStoryIndex(nextIndex);
            setStoryProgress(0);
            viewStatus(viewingGroup.statuses[nextIndex]._id);
        } else {
            // Move to next group
            const currentGroupIndex = groupedStatuses.findIndex(g => g.authorId === viewingGroup.authorId);
            if (currentGroupIndex < groupedStatuses.length - 1) {
                const nextGroup = groupedStatuses[currentGroupIndex + 1];
                openStoryViewer(nextGroup, 0);
            } else {
                closeStoryViewer();
            }
        }
    };

    const handlePrevStory = () => {
        if (!viewingGroup) return;

        if (currentStoryIndex > 0) {
            // Previous story in same group
            const prevIndex = currentStoryIndex - 1;
            setCurrentStoryIndex(prevIndex);
            setStoryProgress(0);
            viewStatus(viewingGroup.statuses[prevIndex]._id);
        } else {
            // Move to previous group
            const currentGroupIndex = groupedStatuses.findIndex(g => g.authorId === viewingGroup.authorId);
            if (currentGroupIndex > 0) {
                const prevGroup = groupedStatuses[currentGroupIndex - 1];
                openStoryViewer(prevGroup, prevGroup.statuses.length - 1);
            }
        }
    };

    const handleLikeCurrentStory = async () => {
        if (!viewingGroup) return;
        const status = viewingGroup.statuses[currentStoryIndex];

        try {
            if (status.isLiked) {
                const result = await unlikeStatusApi(status._id);
                setStatuses(prev => prev.map(s =>
                    s._id === status._id ? { ...s, isLiked: false, likesCount: result.likesCount } : s
                ));
            } else {
                const result = await likeStatusApi(status._id);
                setStatuses(prev => prev.map(s =>
                    s._id === status._id ? { ...s, isLiked: true, likesCount: result.likesCount } : s
                ));
            }
        } catch (error) {
            console.error('Failed to toggle like:', error);
            showError("Impossible d'aimer la story");
        }
    };

    const handleDeleteCurrentStory = async () => {
        if (!viewingGroup) return;
        const status = viewingGroup.statuses[currentStoryIndex];

        setConfirmAction({
            title: 'Supprimer la story',
            message: 'Voulez-vous vraiment supprimer cette story ? Cette action est irréversible.',
            onConfirm: async () => {
                try {
                    await deleteStatus(status._id);
                    setStatuses(prev => prev.filter(s => s._id !== status._id));
                    showSuccess('Story supprimée');
                    setShowConfirmModal(false);
                    handleNextStory();
                } catch (error) {
                    console.error('Failed to delete status:', error);
                    showError('Impossible de supprimer la story');
                }
            }
        });
        setShowConfirmModal(true);
    };

    const handleCreateStatus = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newStatus.category || !newStatus.content.trim()) return;

        setComposerLoading(true);
        try {
            const status = await createStatus({
                category: newStatus.category,
                content: newStatus.content.trim(),
                media: newStatus.media || undefined
            });

            setStatuses(prev => [status, ...prev]);
            setNewStatus({ category: '', content: '', media: null });
            setShowComposer(false);
            showSuccess('Story publiée');
        } catch (error) {
            console.error('Failed to create status:', error);
            showError('Impossible de publier la story');
        } finally {
            setComposerLoading(false);
        }
    };

    const formatTimeAgo = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffHours = Math.floor(diffMs / 3600000);

        if (diffHours < 1) return "À l'instant";
        if (diffHours < 24) return `Il y a ${diffHours} h`;
        return `Il y a ${Math.floor(diffHours / 24)} j`;
    };

    const currentStory = viewingGroup?.statuses[currentStoryIndex];

    return (
        <div>
            <ToastContainer toasts={toasts} onRemove={removeToast} />

            {/* Header */}
            <h1 className="mb-6 text-2xl font-semibold tracking-tight text-fg">Stories</h1>

            {/* Stories Bar */}
            <div className="bg-surface border border-line rounded-lg px-4 py-4 overflow-x-auto">
                <div className="flex gap-4">
                    {/* Add Your Story */}
                    <button
                        onClick={() => setShowComposer(true)}
                        className="shrink-0 flex flex-col items-center gap-2 group"
                    >
                        <div className="relative">
                            <div className="w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center border-2 border-line-strong group-hover:border-indigo-500 transition-colors">
                                <Plus className="w-6 h-6 text-fg-muted group-hover:text-indigo-500" />
                            </div>
                        </div>
                        <span className="text-xs text-fg-muted group-hover:text-fg">Votre story</span>
                    </button>

                    {/* User Stories */}
                    {loading ? (
                        <div className="flex items-center justify-center flex-1">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
                        </div>
                    ) : groupedStatuses.length === 0 ? (
                        <div className="flex-1 text-center text-fg-muted py-4">
                            Aucune story pour le moment. Publiez la première !
                        </div>
                    ) : (
                        groupedStatuses.map(group => (
                            <button
                                key={group.authorId}
                                onClick={() => openStoryViewer(group)}
                                className="shrink-0 flex flex-col items-center gap-2 group"
                            >
                                <div className="relative">
                                    <div className={`w-16 h-16 rounded-full p-0.5 ${group.hasUnviewed ? 'bg-linear-to-tr from-yellow-400 to-pink-600' : 'bg-surface-3'}`}>
                                        <div className="w-full h-full rounded-full bg-surface p-0.5">
                                            {group.authorAvatar ? (
                                                <img
                                                    src={group.authorAvatar}
                                                    alt={group.authorName}
                                                    className="w-full h-full rounded-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full rounded-full bg-indigo-600 flex items-center justify-center text-white font-semibold">
                                                    {group.authorName.charAt(0).toUpperCase()}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="absolute bottom-0 right-0 bg-background rounded-full px-1.5 py-0.5 text-xs text-fg border border-line">
                                        {group.statuses.length}
                                    </div>
                                </div>
                                <span className="text-xs text-fg-muted max-w-[64px] truncate group-hover:text-fg">
                                    {group.authorName}
                                </span>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Story Viewer Modal */}
            {viewingGroup && currentStory && (
                <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
                    {/* Story Container */}
                    <div className="relative w-full max-w-md h-full bg-gray-900 flex flex-col">
                        {/* Progress Bars */}
                        <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-2">
                            {viewingGroup.statuses.map((_, index) => (
                                <div key={index} className="flex-1 h-0.5 bg-gray-600 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-white transition-all"
                                        style={{
                                            width: index < currentStoryIndex ? '100%' :
                                                   index === currentStoryIndex ? `${storyProgress}%` : '0%'
                                        }}
                                    />
                                </div>
                            ))}
                        </div>

                        {/* Header */}
                        <div className="absolute top-4 left-0 right-0 z-20 px-4 pt-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {viewingGroup.authorAvatar ? (
                                        <img
                                            src={viewingGroup.authorAvatar}
                                            alt={viewingGroup.authorName}
                                            className="w-8 h-8 rounded-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-semibold">
                                            {viewingGroup.authorName.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    <div>
                                        <div className="text-white text-sm font-medium">{viewingGroup.authorName}</div>
                                        <div className="text-gray-400 text-xs flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {formatTimeAgo(currentStory.createdAt)}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={closeStoryViewer}
                                    aria-label="Fermer"
                                    className="text-white hover:bg-white/10 rounded-full p-1 transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>
                        </div>

                        {/* Story Content */}
                        <div className="flex-1 relative flex items-center justify-center">
                            {/* Navigation Areas */}
                            <button
                                onClick={handlePrevStory}
                                aria-label="Story précédente"
                                className="absolute left-0 top-0 bottom-0 w-1/3 z-10 hover:bg-linear-to-r hover:from-black/20"
                            >
                                {currentStoryIndex > 0 && (
                                    <ChevronLeft className="w-8 h-8 text-white/50 absolute left-4 top-1/2 -translate-y-1/2" />
                                )}
                            </button>
                            <button
                                onClick={handleNextStory}
                                aria-label="Story suivante"
                                className="absolute right-0 top-0 bottom-0 w-1/3 z-10 hover:bg-linear-to-l hover:from-black/20"
                            >
                                <ChevronRight className="w-8 h-8 text-white/50 absolute right-4 top-1/2 -translate-y-1/2" />
                            </button>

                            {/* Media or Text */}
                            {currentStory.mediaUrl ? (
                                currentStory.mediaType === 'video' ? (
                                    <video
                                        src={currentStory.mediaUrl}
                                        className="w-full h-full object-contain"
                                        autoPlay
                                        muted
                                        playsInline
                                    />
                                ) : (
                                    <img
                                        src={currentStory.mediaUrl}
                                        alt="Story"
                                        className="w-full h-full object-contain"
                                    />
                                )
                            ) : (
                                <div className="w-full h-full flex items-center justify-center p-8">
                                    <div className="text-center">
                                        <p className="text-white text-xl leading-relaxed">
                                            {currentStory.content}
                                        </p>
                                        {currentStory.country && (
                                            <div className="flex items-center justify-center gap-1 text-gray-400 mt-4">
                                                <MapPin className="w-4 h-4" />
                                                <span className="text-sm">{currentStory.city || currentStory.country}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Content Overlay (for media stories) */}
                            {currentStory.mediaUrl && (
                                <div className="absolute bottom-20 left-0 right-0 px-4">
                                    <div className="bg-linear-to-t from-black/80 to-transparent p-4 rounded-lg">
                                        <p className="text-white text-sm leading-relaxed">{currentStory.content}</p>
                                        {currentStory.country && (
                                            <div className="flex items-center gap-1 text-gray-300 mt-2">
                                                <MapPin className="w-3 h-3" />
                                                <span className="text-xs">{currentStory.city || currentStory.country}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Bottom Actions */}
                        <div className="absolute bottom-0 left-0 right-0 p-4 bg-linear-to-t from-black/80 to-transparent">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={handleLikeCurrentStory}
                                    aria-label="J'aime"
                                    className={`flex items-center gap-2 ${currentStory.isLiked ? 'text-red-500' : 'text-white'}`}
                                >
                                    <Heart className={`w-6 h-6 ${currentStory.isLiked ? 'fill-current' : ''}`} />
                                    <span className="text-sm">{currentStory.likesCount}</span>
                                </button>
                                <div className="flex items-center gap-2 text-white">
                                    <Eye className="w-5 h-5" />
                                    <span className="text-sm">{currentStory.viewsCount}</span>
                                </div>
                                <div className="flex-1" />
                                <button
                                    onClick={handleDeleteCurrentStory}
                                    aria-label="Supprimer la story"
                                    className="text-white hover:text-red-500 transition-colors"
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Story Composer Modal - Full Screen with Preview */}
            {showComposer && (
                <div className="fixed inset-0 bg-black z-50">
                    {/* Story Preview */}
                    <div className="relative w-full h-full flex items-center justify-center">
                        {/* Background/Media Preview */}
                        {newStatus.media ? (
                            newStatus.media.type.startsWith('video/') ? (
                                <video
                                    src={URL.createObjectURL(newStatus.media)}
                                    className="w-full h-full object-contain"
                                    controls={false}
                                    autoPlay
                                    loop
                                    muted
                                />
                            ) : (
                                <img
                                    src={URL.createObjectURL(newStatus.media)}
                                    alt="Aperçu de la story"
                                    className="w-full h-full object-contain"
                                />
                            )
                        ) : (
                            // Gradient background for text-only stories
                            <div className="w-full h-full bg-linear-to-br from-indigo-600 via-purple-600 to-pink-600" />
                        )}

                        {/* Top Bar - Close and Category */}
                        <div className="absolute top-0 left-0 right-0 p-4 bg-linear-to-b from-black/60 to-transparent">
                            <div className="flex items-center justify-between">
                                <button
                                    onClick={() => {
                                        setShowComposer(false);
                                        setNewStatus({ category: '', content: '', media: null });
                                    }}
                                    aria-label="Fermer"
                                    className="text-white hover:bg-white/10 rounded-full p-2 transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>

                                {/* Category Selector */}
                                <div className="flex-1 mx-4">
                                    <select
                                        value={newStatus.category}
                                        onChange={(e) => setNewStatus({ ...newStatus, category: e.target.value })}
                                        className="w-full max-w-xs px-3 py-2 bg-black/40 text-white rounded-full text-sm border border-white/20 focus:outline-hidden focus:border-white/40"
                                    >
                                        <option value="">Choisir une catégorie…</option>
                                        {categories.filter(c => !c.adminOnly).map(cat => (
                                            <option key={cat.key} value={cat.key}>{cat.nameFr || cat.nameEn}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Text Overlay (on top of media or gradient) */}
                        <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none">
                            <div className="w-full max-w-lg text-center">
                                {newStatus.content && (
                                    <p className="text-white text-xl md:text-2xl font-semibold leading-relaxed">
                                        {newStatus.content}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Bottom Controls */}
                        <div className="absolute bottom-0 left-0 right-0 p-4 bg-linear-to-t from-black/80 to-transparent pointer-events-auto">
                            <div className="max-w-2xl mx-auto space-y-3">
                                {/* Text Input */}
                                <div className="relative">
                                    <textarea
                                        value={newStatus.content}
                                        onChange={(e) => setNewStatus({ ...newStatus, content: e.target.value })}
                                        placeholder="Ajoutez un texte à votre story…"
                                        rows={2}
                                        maxLength={2000}
                                        className="w-full px-4 py-3 bg-white/10 backdrop-blur-xs border border-white/20 rounded-lg text-white placeholder-white/60 focus:outline-hidden focus:border-white/40 resize-none"
                                    />
                                    <div className="absolute bottom-2 right-2 text-xs text-white/60">
                                        {newStatus.content.length}/2000
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex items-center gap-3">
                                    {/* Media Upload Buttons */}
                                    {!newStatus.media && (
                                        <>
                                            <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white/10 backdrop-blur-xs border border-white/20 rounded-lg text-white hover:bg-white/20 cursor-pointer transition-colors">
                                                <Image className="w-5 h-5" />
                                                <span className="text-sm font-medium">Photo</span>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    onChange={(e) => setNewStatus({ ...newStatus, media: e.target.files?.[0] || null })}
                                                />
                                            </label>
                                            <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white/10 backdrop-blur-xs border border-white/20 rounded-lg text-white hover:bg-white/20 cursor-pointer transition-colors">
                                                <Video className="w-5 h-5" />
                                                <span className="text-sm font-medium">Vidéo</span>
                                                <input
                                                    type="file"
                                                    accept="video/*"
                                                    className="hidden"
                                                    onChange={(e) => setNewStatus({ ...newStatus, media: e.target.files?.[0] || null })}
                                                />
                                            </label>
                                        </>
                                    )}

                                    {/* Remove Media Button (if media exists) */}
                                    {newStatus.media && (
                                        <button
                                            type="button"
                                            onClick={() => setNewStatus({ ...newStatus, media: null })}
                                            className="px-4 py-3 bg-red-500/80 backdrop-blur-xs rounded-lg text-white hover:bg-red-600/80 transition-colors flex items-center gap-2"
                                        >
                                            <X className="w-5 h-5" />
                                            <span className="text-sm font-medium">Retirer</span>
                                        </button>
                                    )}

                                    {/* Post Button */}
                                    <button
                                        onClick={handleCreateStatus}
                                        disabled={!newStatus.category || !newStatus.content.trim() || composerLoading}
                                        className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 rounded-lg text-white font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {composerLoading ? (
                                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                                        ) : (
                                            <>
                                                <Send className="w-5 h-5" />
                                                Publier la story
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmation Modal */}
            {confirmAction && (
                <ConfirmationModal
                    isOpen={showConfirmModal}
                    title={confirmAction.title}
                    message={confirmAction.message}
                    confirmText="Supprimer"
                    cancelText="Annuler"
                    onConfirm={confirmAction.onConfirm}
                    onCancel={() => setShowConfirmModal(false)}
                />
            )}
        </div>
    );
};

export default StatusPage;
