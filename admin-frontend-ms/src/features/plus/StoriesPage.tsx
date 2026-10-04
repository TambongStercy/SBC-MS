import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Heart, MessageCircle, Trash2 } from 'lucide-react';
import { createStatus, deleteStatus, getCategories, getStatusFeed, type Status } from '../../services/statusApi';
import { Badge, Button, Card, ConfirmSheet, EmptyState, ErrorState, Input, KeyValue, ListSkeleton, MemberLink, Page, Pagination, SearchInput, Select, Sheet, Tabs, Textarea, notify } from '../../ui';
import { formatDateTime, formatNumber, timeAgo } from '../../lib/format';
import { errorMessage, useDebounced, useParamState } from '../../lib/hooks';

const hoursLeft = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));

function Thumb({ s }: { s: Status }) {
    const src = s.mediaThumbnailUrl || (s.mediaType === 'image' || s.mediaType === 'flyer' ? s.mediaUrl : undefined);
    if (src) return <img src={src} alt="" loading="lazy" className="size-full object-cover" />;
    return <span className="size-full grid place-items-center p-3 text-center text-sm font-semibold text-white bg-primary line-clamp-6">{s.content || 'Story'}</span>;
}

/** The stories members post (24 h), and SBC's own: moderate them, or publish as SBC. */
export default function StoriesPage() {
    const qc = useQueryClient();
    const [tab, setTab] = useParamState('onglet', 'stories');
    const [category, setCategory] = useState('');
    const [sortBy, setSortBy] = useState<'recent' | 'popular'>('recent');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const term = useDebounced(search);
    const [open, setOpen] = useState<Status | null>(null);
    const [remove, setRemove] = useState<Status | null>(null);
    const categories = useQuery({ queryKey: ['stories', 'categories'], queryFn: getCategories, staleTime: 600_000 });
    const feed = useQuery({
        queryKey: ['stories', category, sortBy, term, page],
        queryFn: () => getStatusFeed({ category: category || undefined, sortBy, search: term || undefined }, page, 24),
        placeholderData: keepPreviousData,
        refetchInterval: 60_000,
    });
    const catName = (key: string) => categories.data?.find(c => c.key === key)?.nameFr ?? key;

    // Composer
    const [draft, setDraft] = useState({ category: '', content: '', media: null as File | null });
    const [publishing, setPublishing] = useState(false);
    const publish = async () => {
        if (!draft.category || (!draft.content.trim() && !draft.media)) return;
        setPublishing(true);
        try {
            await createStatus({ category: draft.category, content: draft.content.trim(), ...(draft.media ? { media: draft.media } : {}) });
            notify.success('Story publiée pour 24 h.');
            setDraft({ category: '', content: '', media: null });
            qc.invalidateQueries({ queryKey: ['stories'] });
            setTab('stories');
        } catch (e) { notify.error(errorMessage(e, 'Publication impossible.')); } finally { setPublishing(false); }
    };

    return (
        <Page title="Stories" width="wide">
            <div className="space-y-4">
                <Tabs value={tab} onChange={setTab} items={[{ value: 'stories', label: 'Stories des membres' }, { value: 'publier', label: 'Publier en tant que SBC' }]} />
                {tab === 'publier' ? (
                    <Card className="space-y-4 max-w-xl">
                        <Select label="Catégorie" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
                            <option value="">Choisir…</option>
                            {(categories.data ?? []).map(c => <option key={c.key} value={c.key}>{c.nameFr}{c.adminOnly ? ' (réservée à SBC)' : ''}</option>)}
                        </Select>
                        <Textarea label="Texte" rows={4} value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} />
                        <Input label="Photo ou vidéo (facultatif)" type="file" accept="image/*,video/*" onChange={e => setDraft({ ...draft, media: e.target.files?.[0] ?? null })} />
                        <Button full loading={publishing} disabled={!draft.category || (!draft.content.trim() && !draft.media)} onClick={publish}>Publier pour 24 h</Button>
                    </Card>
                ) : (
                    <>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <SearchInput className="flex-1" value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Chercher dans les stories" />
                            <div className="grid grid-cols-2 gap-2 sm:w-96">
                                <Select aria-label="Catégorie" value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}>
                                    <option value="">Toutes</option>{(categories.data ?? []).map(c => <option key={c.key} value={c.key}>{c.nameFr}</option>)}
                                </Select>
                                <Select aria-label="Tri" value={sortBy} onChange={e => { setSortBy(e.target.value as typeof sortBy); setPage(1); }}>
                                    <option value="recent">Plus récentes</option><option value="popular">Plus vues</option>
                                </Select>
                            </div>
                        </div>
                        {feed.isLoading ? <ListSkeleton /> : feed.isError ? <ErrorState onRetry={() => feed.refetch()} /> : !feed.data?.data.length ? (
                            <Card><EmptyState title="Aucune story en ce moment" /></Card>
                        ) : (
                            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                                {feed.data.data.map(s => (
                                    <li key={s._id}>
                                        <button type="button" onClick={() => setOpen(s)} className="w-full text-left rounded-card overflow-hidden border border-border bg-surface">
                                            <span className="block aspect-[9/14] bg-surface-2 overflow-hidden"><Thumb s={s} /></span>
                                            <span className="block p-2">
                                                <span className="block text-sm font-semibold truncate">{s.author?.name ?? 'Membre'}</span>
                                                <span className="block text-xs text-ink-3 truncate">{catName(s.category)} · {timeAgo(s.createdAt)}</span>
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {feed.data && <Pagination page={feed.data.pagination.currentPage} totalPages={feed.data.pagination.totalPages} total={feed.data.pagination.totalCount} onChange={setPage} />}
                    </>
                )}
            </div>

            {open && (
                <Sheet open onClose={() => setOpen(null)} title="Story" size="lg"
                    footer={<Button variant="danger-soft" full icon={<Trash2 size={16} />} onClick={() => setRemove(open)}>Supprimer la story</Button>}>
                    <div className="space-y-4">
                        <MemberLink id={open.author?._id ?? open.authorId} name={open.author?.name} avatar={open.author?.avatar} sub={`${catName(open.category)} · ${formatDateTime(open.createdAt)}`} />
                        {open.mediaType === 'video' && open.mediaUrl ? <video src={open.mediaUrl} controls playsInline className="w-full max-h-[60vh] rounded-tile bg-black" />
                            : (open.mediaType === 'image' || open.mediaType === 'flyer') && open.mediaUrl ? <img src={open.mediaUrl} alt="" className="w-full max-h-[60vh] object-contain rounded-tile bg-surface-2" /> : null}
                        {open.content && <p className="whitespace-pre-line">{open.content}</p>}
                        <div className="flex flex-wrap gap-2">
                            <Badge><Eye size={12} />{formatNumber(open.viewsCount)} vues</Badge>
                            <Badge><Heart size={12} />{formatNumber(open.likesCount)}</Badge>
                            <Badge><MessageCircle size={12} />{formatNumber(open.repliesCount)} réponses</Badge>
                            <Badge tone="warning">Disparaît dans {hoursLeft(open.expiresAt)} h</Badge>
                        </div>
                        {(open.country || open.city) && <KeyValue items={[['Lieu', [open.city, open.country].filter(Boolean).join(', ')]]} />}
                    </div>
                </Sheet>
            )}
            <ConfirmSheet open={!!remove} onClose={() => setRemove(null)} tone="danger" title="Supprimer cette story ?"
                message={<p>La story de {remove?.author?.name ?? 'ce membre'} disparaît pour tout le monde. Le membre n’est pas prévenu.</p>}
                confirmLabel="Supprimer"
                onConfirm={async () => { await deleteStatus(remove!._id); notify.success('Story supprimée.'); setOpen(null); qc.invalidateQueries({ queryKey: ['stories'] }); }} />
        </Page>
    );
}
