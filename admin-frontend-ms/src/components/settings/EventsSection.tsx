import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Calendar03Icon, Delete02Icon, Edit02Icon, MoreHorizontalIcon, Video01Icon } from '@hugeicons/core-free-icons';
import apiClient from '../../api/apiClient';
import { createEvent, deleteEvent, getEvents, updateEvent, type IEvent } from '../../services/adminSettingsApi';
import { getFileUrl } from '../../utils/fileUtils';
import { ImageDisplay } from '../common/ImageDisplay';
import { Can } from '../Can';
import {
    Button, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuTrigger,
    Pagination, Panel, PanelHeader, ResponsiveList, SheetContent, Textarea, type ListColumn,
} from '../ui';
import { ErrorState } from '../display/ErrorState';
import { RelativeDate } from '../display/RelativeDate';
import { apiError } from '../display/format';
import { FileDrop } from './FileDrop';

const PAGE_SIZE = 5;
const EVENTS_KEY = ['admin-settings', 'events'] as const;

const fileUrl = (fileId?: string) => (fileId ? getFileUrl(fileId, `${apiClient.defaults.baseURL || ''}/settings/files`) : null);

/** Object URL of a picked file, released when the file changes. */
function useObjectUrl(file: File | null) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!file) { setUrl(null); return; }
        const u = URL.createObjectURL(file);
        setUrl(u);
        return () => URL.revokeObjectURL(u);
    }, [file]);
    return url;
}

/** Publish or edit a community event (title, text, image, optional video). */
function EventSheet({ editing, onDone }: { editing: IEvent | null; onDone: () => void }) {
    const queryClient = useQueryClient();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [image, setImage] = useState<File | null>(null);
    const [video, setVideo] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);
    const imagePreview = useObjectUrl(image);
    const videoPreview = useObjectUrl(video);

    useEffect(() => {
        setTitle(editing?.title ?? '');
        setDescription(editing?.description ?? '');
        setImage(null);
        setVideo(null);
        setError(null);
    }, [editing]);

    // While editing, the files already online show until a new one is picked.
    const shownImage = imagePreview ?? fileUrl(editing?.image?.fileId);
    const shownVideo = videoPreview ?? fileUrl(editing?.video?.fileId);

    const save = useMutation({
        mutationFn: async () => {
            const data = {
                title: title.trim(),
                description: description.trim(),
                ...(image ? { imageFile: image } : {}),
                ...(video ? { videoFile: video } : {}),
            };
            if (editing) return updateEvent(editing._id, data);
            if (!image) throw new Error('L’image est obligatoire pour un nouvel événement.');
            return createEvent({ ...data, imageFile: image });
        },
        onSuccess: () => {
            toast.success(editing ? 'Événement mis à jour.' : 'Événement publié.');
            void queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
            onDone();
        },
        onError: err => {
            const message = apiError(err, err instanceof Error && err.message ? err.message : 'L’événement n’a pas pu être enregistré.');
            setError(message);
            toast.error(message);
        },
    });

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (!title.trim() || !description.trim() || (!image && !editing)) {
            setError(editing ? 'Le titre et la description sont obligatoires.' : 'Le titre, la description et l’image sont obligatoires.');
            return;
        }
        save.mutate();
    };

    return (
        <SheetContent
            width="lg"
            title={editing ? 'Modifier l’événement' : 'Publier un événement'}
            description="Il apparaît dans les actualités de l’application membre."
            footer={(
                <>
                    <DialogClose asChild><Button variant="outline" size="lg" disabled={save.isPending}>Annuler</Button></DialogClose>
                    <Button type="submit" form="event-form" variant="primary" size="lg" loading={save.isPending}>
                        {editing ? 'Enregistrer' : 'Publier l’événement'}
                    </Button>
                </>
            )}
        >
            <form id="event-form" onSubmit={submit} className="space-y-4">
                <Field label="Titre" required>
                    <Input className="h-11" value={title} onChange={e => setTitle(e.target.value)} />
                </Field>
                <Field label="Description" required>
                    <Textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} />
                </Field>
                <div className="space-y-2">
                    <p className="text-sm font-medium text-fg">Image{!editing && <span className="text-danger" aria-hidden="true"> *</span>}</p>
                    <FileDrop accept={{ 'image/*': [] }} file={image} onFile={setImage} hint={editing ? 'Laissez vide pour garder l’image actuelle.' : 'Obligatoire. JPG, PNG, WEBP…'} disabled={save.isPending} />
                    {shownImage && (
                        <figure>
                            <figcaption className="mb-1 text-xs text-fg-muted">{image ? 'Nouvelle image' : 'Image actuelle'}</figcaption>
                            <img src={shownImage} alt="" className="max-h-36 rounded-md border border-line" />
                        </figure>
                    )}
                </div>
                <div className="space-y-2">
                    <p className="text-sm font-medium text-fg">Vidéo <span className="font-normal text-fg-muted">(facultatif)</span></p>
                    <FileDrop accept={{ 'video/*': [] }} file={video} onFile={setVideo} hint={editing ? 'Laissez vide pour garder la vidéo actuelle.' : 'MP4, WEBM…'} disabled={save.isPending} />
                    {shownVideo && (
                        <figure>
                            <figcaption className="mb-1 text-xs text-fg-muted">{video ? 'Nouvelle vidéo' : 'Vidéo actuelle'}</figcaption>
                            <video src={shownVideo} controls preload="metadata" className="max-h-40 rounded-md border border-line" />
                        </figure>
                    )}
                </div>
                {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            </form>
        </SheetContent>
    );
}

/**
 * Community events shown to members (settings-service /settings/events),
 * newest first, five per page.
 */
export function EventsSection({ page, onPageChange, createOpen, onCreateOpenChange }: {
    page: number;
    onPageChange: (page: number) => void;
    createOpen: boolean;
    onCreateOpenChange: (open: boolean) => void;
}) {
    const queryClient = useQueryClient();
    const events = useQuery({
        queryKey: [...EVENTS_KEY, page],
        queryFn: () => getEvents({ page, limit: PAGE_SIZE, sortOrder: 'desc' }),
        placeholderData: keepPreviousData,
    });
    const [editing, setEditing] = useState<IEvent | null>(null);
    const [removing, setRemoving] = useState<IEvent | null>(null);

    const rows = useMemo(() => events.data?.events ?? [], [events.data]);

    const remove = useMutation({
        mutationFn: (ev: IEvent) => deleteEvent(ev._id),
        onSuccess: (_, ev) => {
            toast.success(`« ${ev.title} » a été supprimé.`);
            setRemoving(null);
            if (rows.length === 1 && page > 1) onPageChange(page - 1);
            void queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
        },
        onError: err => toast.error(apiError(err, 'L’événement n’a pas pu être supprimé.')),
    });

    const sheetOpen = createOpen || !!editing;
    const closeSheet = () => { setEditing(null); onCreateOpenChange(false); };

    const thumb = (ev: IEvent) => (
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-surface-3">
            {ev.image?.fileId && <ImageDisplay fileId={ev.image.fileId} alt="" className="h-full w-full object-cover" />}
            {ev.video?.fileId && (
                <span className="absolute bottom-0.5 right-0.5 rounded bg-ink/80 p-0.5 text-ink-fg" title="Avec vidéo">
                    <HugeiconsIcon icon={Video01Icon} size={12} aria-label="Avec vidéo" />
                </span>
            )}
        </div>
    );

    const rowActions = (ev: IEvent, phone = false) => (
        <Can module="settings" write>
            <div className={phone ? 'flex gap-2' : 'flex justify-end gap-1'}>
                <Button variant={phone ? 'outline' : 'ghost'} size={phone ? 'lg' : 'sm'} className={phone ? 'flex-1' : undefined} onClick={() => setEditing(ev)}>
                    <HugeiconsIcon icon={Edit02Icon} size={16} aria-hidden="true" />
                    Modifier
                </Button>
                <Menu>
                    <MenuTrigger asChild>
                        <Button variant="ghost" size={phone ? 'lg' : 'icon-sm'} className={phone ? 'w-11 px-0' : undefined} aria-label={`Plus d’actions pour ${ev.title}`}>
                            <HugeiconsIcon icon={MoreHorizontalIcon} size={16} aria-hidden="true" />
                        </Button>
                    </MenuTrigger>
                    <MenuContent>
                        <MenuItem destructive onSelect={() => setRemoving(ev)}>
                            <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />
                            Supprimer
                        </MenuItem>
                    </MenuContent>
                </Menu>
            </div>
        </Can>
    );

    const columns: ListColumn<IEvent>[] = [
        {
            key: 'event', header: 'Événement', className: 'max-w-0 w-2/3',
            cell: ev => (
                <div className="flex min-w-0 items-center gap-3">
                    {thumb(ev)}
                    <div className="min-w-0">
                        <p className="truncate font-medium text-fg">{ev.title}</p>
                        <p className="line-clamp-2 text-xs text-fg-muted">{ev.description}</p>
                    </div>
                </div>
            ),
        },
        { key: 'date', header: 'Publié', cell: ev => <RelativeDate value={String(ev.timestamp || ev.createdAt)} className="text-sm text-fg-muted" /> },
        { key: 'actions', header: <span className="sr-only">Actions</span>, cell: ev => rowActions(ev), className: 'text-right', hideOnCard: true },
    ];

    const card = (ev: IEvent) => (
        <div className="space-y-3">
            <div className="flex items-start gap-3">
                {thumb(ev)}
                <div className="min-w-0 flex-1">
                    <p className="font-medium text-fg">{ev.title}</p>
                    <p className="line-clamp-2 text-sm text-fg-muted">{ev.description}</p>
                    <RelativeDate value={String(ev.timestamp || ev.createdAt)} className="text-xs text-fg-subtle" />
                </div>
            </div>
            {rowActions(ev, true)}
        </div>
    );

    const total = events.data?.totalCount ?? rows.length;

    return (
        <Panel>
            <PanelHeader
                title="Événements"
                description={events.data && total > 0 ? `${total} événement${total > 1 ? 's publiés' : ' publié'} pour les membres` : 'Les actualités que les membres voient dans l’application.'}
            />
            <div className={events.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
                <ResponsiveList
                    rows={rows}
                    columns={columns}
                    rowKey={ev => ev._id}
                    card={card}
                    loading={events.isLoading}
                    loadingRows={PAGE_SIZE}
                    empty={events.isError ? (
                        <ErrorState message={apiError(events.error, 'Les événements n’ont pas pu être chargés.')} onRetry={() => void events.refetch()} retrying={events.isFetching} />
                    ) : (
                        <EmptyState
                            icon={Calendar03Icon}
                            title="Aucun événement"
                            description="Publiez une actualité avec une image : les membres la voient aussitôt."
                            action={<Can module="settings" write><Button variant="primary" size="lg" onClick={() => onCreateOpenChange(true)}>Publier un événement</Button></Can>}
                        />
                    )}
                />
            </div>
            <Pagination page={page} totalPages={events.data?.totalPages ?? 1} total={total} pageSize={PAGE_SIZE} onPageChange={onPageChange} />

            <Dialog open={sheetOpen} onOpenChange={open => { if (!open) closeSheet(); }}>
                {sheetOpen && <EventSheet editing={editing} onDone={closeSheet} />}
            </Dialog>

            <Dialog open={!!removing} onOpenChange={open => { if (!open && !remove.isPending) setRemoving(null); }}>
                {removing && (
                    <DialogContent
                        size="sm"
                        title="Supprimer cet événement ?"
                        description={`« ${removing.title} » disparaît de l’application membre. C’est définitif.`}
                        footer={(
                            <>
                                <DialogClose asChild><Button variant="outline" size="lg" disabled={remove.isPending}>Annuler</Button></DialogClose>
                                <Button variant="danger" size="lg" loading={remove.isPending} onClick={() => remove.mutate(removing)}>Supprimer</Button>
                            </>
                        )}
                    />
                )}
            </Dialog>
        </Panel>
    );
}
