import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, Cancel01Icon, FilterIcon, PlayCircleIcon, Search01Icon, ImageNotFound01Icon } from '@hugeicons/core-free-icons';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../context/AuthContext';
import {
    getStatusFeed,
    getCategories,
    createStatus,
    likeStatus as likeStatusApi,
    unlikeStatus as unlikeStatusApi,
    deleteStatus,
    Status,
    StatusCategory,
    type PaginationInfo,
} from '../services/statusApi';
import { Can } from '../components/Can';
import { Badge, Button, Dialog, EmptyState, Input, Metric, PageHeader, Panel, Segmented, Select, SheetContent, Skeleton } from '../components/ui';
import { PageFilters } from '../components/filters/PageFilters';
import { usePageFilters } from '../hooks/usePageFilters';
import { ErrorState } from '../components/display/ErrorState';
import { apiError, fmtInt } from '../components/display/format';
import { useUrlParams } from '../components/display/useUrlParams';
import { ConfirmDialog, type ConfirmRequest } from '../components/chat/ConfirmDialog';
import { MemberInfoSheet } from '../components/chat/MemberInfoSheet';
import { StatusCard } from '../components/statuses/StatusCard';
import { StatusComposerSheet, type StatusDraft } from '../components/statuses/StatusComposerSheet';
import { StatusDetailSheet } from '../components/statuses/StatusDetailSheet';
import { StoryViewer } from '../components/statuses/StoryViewer';
import { categoryLabel, groupByAuthor } from '../components/statuses/status-utils';

const URL_DEFAULTS = { q: '', categorie: '', type: '', tri: 'recent' };
const ALL = '__all';

const TYPE_OPTIONS = [
    { value: ALL, label: 'Tous les formats' },
    { value: 'text', label: 'Texte' },
    { value: 'image', label: 'Image ou affiche' },
    { value: 'video', label: 'Vidéo' },
];

const matchesType = (s: Status, type: string) =>
    !type || (type === 'image' ? s.mediaType === 'image' || s.mediaType === 'flyer' : s.mediaType === type);

/**
 * Stories (chat-service statuses): what members posted in the last 24 h.
 * The team checks them, removes those that break the rules, and can post its own.
 */
const StatusPage: React.FC = () => {
    const { socket, subscribeToStatuses, unsubscribeFromStatuses, viewStatus } = useSocket();
    const { adminUser, role } = useAuth();
    const currentUserId = adminUser?._id ?? '';
    const isSuperAdmin = role === 'admin';

    // Country + period (shared row), then this page's own filters.
    const pageFilters = usePageFilters();
    const { apiParams } = pageFilters;
    const filters = useUrlParams(URL_DEFAULTS);
    const setFilter = filters.set;
    const query = filters.get('q');
    const category = filters.get('categorie');
    const type = filters.get('type');
    const sortBy = (filters.get('tri') === 'popular' ? 'popular' : 'recent') as 'recent' | 'popular';

    const [searchDraft, setSearchDraft] = useState(query);
    const [statuses, setStatuses] = useState<Status[]>([]);
    const [pagination, setPagination] = useState<PaginationInfo | null>(null);
    const [categories, setCategories] = useState<StatusCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [openId, setOpenId] = useState<string | null>(null);
    const [viewerStart, setViewerStart] = useState<{ authorId: string; index: number } | null>(null);
    const [composerOpen, setComposerOpen] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [liking, setLiking] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
    const [memberId, setMemberId] = useState<string | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);

    // Search box → URL, 400 ms after the last keystroke
    useEffect(() => { setSearchDraft(query); }, [query]);
    useEffect(() => {
        if (searchDraft === query) return;
        const t = setTimeout(() => setFilter({ q: searchDraft.trim() }), 400);
        return () => clearTimeout(t);
    }, [searchDraft, query, setFilter]);

    useEffect(() => {
        getCategories()
            .then(setCategories)
            .catch(err => {
                console.error('Failed to load categories:', err);
                toast.error('Impossible de charger les catégories');
            });
    }, []);

    // Stories last 24 h: one page of 100 is the whole feed.
    const loadStatuses = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await getStatusFeed({ category: category || undefined, search: query || undefined, sortBy, ...apiParams }, 1, 100);
            setStatuses(response.data);
            setPagination(response.pagination ?? null);
        } catch (err) {
            console.error('Failed to load statuses:', err);
            setError(apiError(err, 'Vérifiez la connexion, puis réessayez.'));
        } finally {
            setLoading(false);
        }
    }, [category, query, sortBy, apiParams]);

    useEffect(() => { void loadStatuses(); }, [loadStatuses]);

    // Live updates
    useEffect(() => {
        subscribeToStatuses();
        return () => unsubscribeFromStatuses();
    }, [subscribeToStatuses, unsubscribeFromStatuses]);

    useEffect(() => {
        if (!socket) return;
        // With a country or period set, only the server knows if a new story matches: reload.
        const handleNewStatus = (status: Status) => {
            if (pageFilters.isFiltered) { void loadStatuses(); return; }
            setStatuses(prev => (prev.some(s => s._id === status._id) ? prev : [status, ...prev]));
        };
        const handleStatusLiked = ({ statusId, likesCount }: { statusId: string; likesCount: number }) => {
            setStatuses(prev => prev.map(s => (s._id === statusId ? { ...s, likesCount } : s)));
        };
        const handleStatusDeleted = ({ statusId }: { statusId: string }) => {
            setStatuses(prev => prev.filter(s => s._id !== statusId));
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
    }, [socket, pageFilters.isFiltered, loadStatuses]);

    // What is shown: the server filters; live arrivals are checked here too.
    const visible = useMemo(() => statuses.filter(s =>
        (!category || s.category === category)
        && matchesType(s, type)
        && (!query || `${s.content} ${s.author?.name ?? ''}`.toLowerCase().includes(query.toLowerCase())),
    ), [statuses, category, type, query]);
    const groups = useMemo(() => groupByAuthor(visible), [visible]);

    const openIndex = openId ? visible.findIndex(s => s._id === openId) : -1;
    const openStatus = openIndex >= 0 ? visible[openIndex] : null;
    const label = useCallback((s: Status) => categoryLabel(s, categories), [categories]);

    const canDelete = useCallback((s: Status) => isSuperAdmin || s.authorId === currentUserId, [isSuperAdmin, currentUserId]);
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const lastHour = visible.filter(s => new Date(s.createdAt).getTime() >= hourAgo).length;

    const toggleLike = async (status: Status) => {
        setLiking(status._id);
        try {
            if (status.isLiked) {
                const result = await unlikeStatusApi(status._id);
                setStatuses(prev => prev.map(s => (s._id === status._id ? { ...s, isLiked: false, likesCount: result.likesCount } : s)));
            } else {
                const result = await likeStatusApi(status._id);
                setStatuses(prev => prev.map(s => (s._id === status._id ? { ...s, isLiked: true, likesCount: result.likesCount } : s)));
            }
        } catch (err) {
            console.error('Failed to toggle like:', err);
            toast.error(apiError(err, 'Impossible d’aimer la story.'));
        } finally {
            setLiking(null);
        }
    };

    const askDelete = (status: Status) => {
        setConfirm({
            title: 'Supprimer la story ?',
            message: `La story de ${status.author?.name || 'ce membre'} disparaît du fil de tous les membres.`,
            warning: 'Cette action est irréversible.',
            onConfirm: async () => {
                try {
                    await deleteStatus(status._id);
                    setStatuses(prev => prev.filter(s => s._id !== status._id));
                    toast.success('Story supprimée.');
                    if (openId === status._id) {
                        const nextStatus = visible[openIndex + 1] ?? visible[openIndex - 1];
                        setOpenId(nextStatus?._id ?? null);
                    }
                } catch (err) {
                    console.error('Failed to delete status:', err);
                    toast.error(apiError(err, 'Impossible de supprimer la story.'));
                }
            },
        });
    };

    const publish = async (draft: StatusDraft) => {
        setPublishing(true);
        try {
            const status = await createStatus({ category: draft.category, content: draft.content.trim(), media: draft.media || undefined });
            setStatuses(prev => [status, ...prev]);
            setComposerOpen(false);
            toast.success('Story publiée.');
            return true;
        } catch (err) {
            console.error('Failed to create status:', err);
            toast.error(apiError(err, 'Impossible de publier la story.'));
            return false;
        } finally {
            setPublishing(false);
        }
    };

    const playFrom = (status?: Status) => {
        const group = status ? groups.find(g => g.authorId === status.author?._id) : groups[0];
        if (!group) return;
        const index = status ? Math.max(0, group.statuses.findIndex(s => s._id === status._id)) : 0;
        setOpenId(null);
        setViewerStart({ authorId: group.authorId, index });
    };
    const closeViewer = useCallback(() => setViewerStart(null), []);
    const onView = useCallback((id: string) => viewStatus(id), [viewStatus]);

    const total = pagination?.totalCount ?? visible.length;
    const postable = categories.filter(c => !c.adminOnly || isSuperAdmin);

    const clearOwnFilters = () => { setSearchDraft(''); filters.clear(); };
    const activeCount = (pageFilters.country ? 1 : 0) + (pageFilters.period !== 'all' ? 1 : 0)
        + (category ? 1 : 0) + (type ? 1 : 0) + (sortBy !== 'recent' ? 1 : 0);
    const searchBox = (cls: string) => (
        <div className="relative min-w-0">
            <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input
                type="search"
                aria-label="Rechercher dans les stories"
                placeholder="Texte ou auteur"
                value={searchDraft}
                onChange={e => setSearchDraft(e.target.value)}
                className={`h-11 pl-9 ${cls}`}
            />
        </div>
    );
    const ownFilters = (cls: string, inSheet = false) => (
        <>
            <Select
                value={category || ALL}
                onValueChange={v => filters.set({ categorie: v === ALL ? '' : v })}
                options={[{ value: ALL, label: 'Toutes les catégories' }, ...categories.map(c => ({ value: c.key, label: c.nameFr || c.nameEn }))]}
                className={`h-11 md:w-48 ${cls}`}
            />
            <Select
                value={type || ALL}
                onValueChange={v => filters.set({ type: v === ALL ? '' : v })}
                options={TYPE_OPTIONS}
                className={`h-11 md:w-40 ${cls}`}
            />
            <Segmented
                label="Tri"
                value={sortBy}
                onValueChange={v => filters.set({ tri: v })}
                options={[{ value: 'recent', label: 'Récentes' }, { value: 'popular', label: 'Populaires' }]}
                size="lg"
                fill={inSheet}
                className="md:w-auto md:[&>button]:h-7"
            />
        </>
    );

    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                title="Stories"
                description="Ce que les membres ont publié ces dernières 24 heures. Ouvrez une story pour la lire en entier et retirer celles qui posent problème."
                className="mb-0"
                actions={(
                    <>
                        <Button variant="outline" size="lg" className="flex-1 sm:flex-none" onClick={() => playFrom()} disabled={groups.length === 0}>
                            <HugeiconsIcon icon={PlayCircleIcon} size={18} aria-hidden="true" /> Lire en continu
                        </Button>
                        <Can module="communication" write>
                            <Button variant="primary" size="lg" className="flex-1 sm:flex-none" onClick={() => setComposerOpen(true)}>
                                <HugeiconsIcon icon={Add01Icon} size={18} aria-hidden="true" /> Publier une story
                            </Button>
                        </Can>
                    </>
                )}
            />

            {/* One filter row: country + period (shared), then this page's own. Phones: search + a "Filtres" sheet. */}
            <PageFilters filters={pageFilters} onReset={clearOwnFilters} className="mb-0 hidden md:flex">
                {searchBox('md:h-9 md:w-56')}
                {ownFilters('md:h-9')}
                {filters.active && !pageFilters.isFiltered && (
                    <Button variant="ghost" size="sm" onClick={clearOwnFilters}>
                        <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" /> Effacer les filtres
                    </Button>
                )}
            </PageFilters>
            <div className="flex gap-2 md:hidden">
                <div className="min-w-0 flex-1">{searchBox('')}</div>
                <Button size="lg" className="shrink-0" onClick={() => setFiltersOpen(true)} aria-label={activeCount ? `Filtres, ${activeCount} actifs` : 'Filtres'}>
                    <HugeiconsIcon icon={FilterIcon} size={16} aria-hidden="true" />
                    Filtres{activeCount > 0 && <Badge tone="primary" className="tabular-nums">{activeCount}</Badge>}
                </Button>
            </div>
            <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
                <SheetContent
                    title="Filtres"
                    description="Pays, période, catégorie, format et tri des stories."
                    footer={<Button variant="primary" size="lg" onClick={() => setFiltersOpen(false)}>Voir {fmtInt(visible.length)} stor{visible.length > 1 ? 'ies' : 'y'}</Button>}
                >
                    <PageFilters filters={pageFilters} onReset={clearOwnFilters} className="mb-0 flex-col items-stretch [&>*]:w-full">
                        {ownFilters('', true)}
                        {filters.active && !pageFilters.isFiltered && (
                            <Button variant="ghost" size="lg" onClick={clearOwnFilters}>Effacer les filtres</Button>
                        )}
                    </PageFilters>
                </SheetContent>
            </Dialog>

            <div className="grid grid-cols-3 gap-3">
                <Metric label="En ligne" value={loading ? <Skeleton className="h-8 w-12" /> : fmtInt(total)} hint={total > visible.length && !loading ? `${fmtInt(visible.length)} affichées` : 'Stories, 24 h'} />
                <Metric label="Auteurs" value={loading ? <Skeleton className="h-8 w-12" /> : fmtInt(groups.length)} hint="Membres distincts" />
                <Metric label="Dernière heure" value={loading ? <Skeleton className="h-8 w-12" /> : fmtInt(lastHour)} hint="Nouvelles à regarder" />
            </div>

            <Panel>
                <div className="p-3">
                    {loading && statuses.length === 0 ? (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" aria-busy="true">
                            {Array.from({ length: 10 }, (_, i) => (
                                <div key={i} className="overflow-hidden rounded-panel border border-line">
                                    <Skeleton className="aspect-[4/5] w-full rounded-none" />
                                    <div className="space-y-2 p-3"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
                                </div>
                            ))}
                        </div>
                    ) : error ? (
                        <ErrorState title="Les stories n’ont pas pu être chargées" message={error} onRetry={() => void loadStatuses()} retrying={loading} />
                    ) : visible.length === 0 ? (
                        <EmptyState
                            icon={ImageNotFound01Icon}
                            title={filters.active || pageFilters.isFiltered ? 'Aucune story ne correspond' : 'Aucune story en ligne'}
                            description={filters.active || pageFilters.isFiltered ? 'Changez la recherche ou les filtres.' : 'Les stories restent en ligne 24 heures. Publiez la première.'}
                            action={filters.active || pageFilters.isFiltered
                                ? <Button size="lg" onClick={() => { pageFilters.reset(); clearOwnFilters(); }}>Effacer les filtres</Button>
                                : <Can module="communication" write><Button variant="primary" size="lg" onClick={() => setComposerOpen(true)}>Publier une story</Button></Can>}
                        />
                    ) : (
                        <ul className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 ${loading ? 'opacity-60' : ''}`}>
                            {visible.map(s => (
                                <li key={s._id} className="min-w-0">
                                    <StatusCard status={s} category={label(s)} onOpen={() => setOpenId(s._id)} />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </Panel>

            <StatusDetailSheet
                status={openStatus}
                category={openStatus ? label(openStatus) : ''}
                position={openIndex}
                total={visible.length}
                canDelete={!!openStatus && canDelete(openStatus)}
                liking={!!openStatus && liking === openStatus._id}
                onClose={() => setOpenId(null)}
                onPrev={() => openIndex > 0 && setOpenId(visible[openIndex - 1]._id)}
                onNext={() => openIndex < visible.length - 1 && setOpenId(visible[openIndex + 1]._id)}
                onLike={() => openStatus && void toggleLike(openStatus)}
                onDelete={() => openStatus && askDelete(openStatus)}
                onPlay={() => openStatus && playFrom(openStatus)}
                onShowAuthor={setMemberId}
            />

            <StoryViewer
                groups={groups}
                start={viewerStart}
                paused={!!confirm}
                onClose={closeViewer}
                onView={onView}
                onLike={s => void toggleLike(s)}
                onDelete={askDelete}
                canDelete={canDelete}
            />

            <StatusComposerSheet
                open={composerOpen}
                onOpenChange={setComposerOpen}
                categories={postable}
                publishing={publishing}
                onPublish={publish}
            />

            <MemberInfoSheet userId={memberId} onClose={() => setMemberId(null)} />
            <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
};

export default StatusPage;
