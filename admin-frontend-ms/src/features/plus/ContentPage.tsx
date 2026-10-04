import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, Plus } from 'lucide-react';
import {
    addFormation, createEvent, deleteEvent, getEvents, getFormations, getSettings, removeFormation, updateEvent, updateFormation, updateSettings,
    uploadCompanyLogo, uploadPresentationPdf, uploadPresentationVideo, uploadTermsPdf,
    type IEvent, type IFileReference, type IFormation,
} from '../../services/adminSettingsApi';
import { Badge, Button, Card, ConfirmSheet, EmptyState, Input, ListSkeleton, Page, Pagination, SectionTitle, Select, Sheet, Tabs, Textarea, notify } from '../../ui';
import { formatDate, thumbnailUrl } from '../../lib/format';
import { errorMessage, useParamState } from '../../lib/hooks';

const API = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000/api';
/** Through our own origin (behind Cloudflare), not the bucket: see CLAUDE.md on egress. */
const streamUrl = (f?: IFileReference) => (f?.fileId ? `${API}/settings/files/${encodeURIComponent(f.fileId)}?stream=1` : '');

const TIER: Record<string, string> = { '': 'Tout le monde', CLASSIQUE: 'Classique et Ciblé', CIBLE: 'Ciblé seulement' };
const DECORATION: Record<string, string> = { '': 'Aucune', orange: 'Surlignée orange', gold: 'Surlignée or', new: 'Badge « Nouveau »' };

function FormationsTab() {
    const qc = useQueryClient();
    const list = useQuery({ queryKey: ['content', 'formations'], queryFn: getFormations });
    const [edit, setEdit] = useState<Partial<IFormation> | null>(null);
    const [remove, setRemove] = useState<IFormation | null>(null);
    const [saving, setSaving] = useState(false);
    const valid = !!edit?.title?.trim() && /^https?:\/\//.test(edit?.link?.trim() ?? '');

    const save = async () => {
        if (!edit || !valid) return;
        setSaving(true);
        const body = { title: edit.title!.trim(), link: edit.link!.trim(), requiredSubscriptionType: (edit.requiredSubscriptionType ?? '') as '' | 'CLASSIQUE' | 'CIBLE', decoration: edit.decoration ?? '' };
        try {
            if (edit._id) await updateFormation(edit._id, body); else await addFormation(body);
            notify.success(edit._id ? 'Formation modifiée.' : 'Formation ajoutée.');
            qc.invalidateQueries({ queryKey: ['content', 'formations'] });
            setEdit(null);
        } catch (e) { notify.error(errorMessage(e, 'Enregistrement impossible.')); } finally { setSaving(false); }
    };

    return (
        <div className="space-y-3">
            <div className="flex justify-end"><Button size="sm" icon={<Plus size={16} />} onClick={() => setEdit({ title: '', link: '', requiredSubscriptionType: undefined, decoration: '' })}>Ajouter</Button></div>
            {list.isLoading ? <ListSkeleton rows={3} /> : !list.data?.length ? <Card><EmptyState title="Aucune formation" /></Card> : (
                <ul className="space-y-2">
                    {list.data.map(f => (
                        <li key={f._id}><Card className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                                <p className="font-semibold">{f.title}</p>
                                <a href={f.link} target="_blank" rel="noreferrer" className="text-sm text-primary break-all inline-flex items-center gap-1">{f.link}<ExternalLink size={12} /></a>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    <Badge tone={f.requiredSubscriptionType ? 'primary' : 'neutral'}>{TIER[f.requiredSubscriptionType ?? '']}</Badge>
                                    {f.decoration && <Badge tone="accent">{DECORATION[f.decoration] ?? f.decoration}</Badge>}
                                </div>
                            </div>
                            <div className="flex flex-col gap-1">
                                <Button size="sm" variant="secondary" onClick={() => setEdit(f)}>Modifier</Button>
                                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemove(f)}>Supprimer</Button>
                            </div>
                        </Card></li>
                    ))}
                </ul>
            )}
            <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?._id ? 'Modifier la formation' : 'Nouvelle formation'}
                footer={<Button full loading={saving} disabled={!valid} onClick={save}>Enregistrer</Button>}>
                {edit && (
                    <div className="space-y-4">
                        <Input label="Titre" value={edit.title ?? ''} onChange={e => setEdit({ ...edit, title: e.target.value })} />
                        <Input label="Lien (https://…)" type="url" value={edit.link ?? ''} onChange={e => setEdit({ ...edit, link: e.target.value })}
                            error={edit.link && !/^https?:\/\//.test(edit.link) ? 'Le lien doit commencer par https://' : undefined} />
                        <Select label="Qui y a accès" value={edit.requiredSubscriptionType ?? ''} onChange={e => setEdit({ ...edit, requiredSubscriptionType: (e.target.value || undefined) as IFormation['requiredSubscriptionType'] })}>
                            {Object.entries(TIER).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </Select>
                        <Select label="Mise en avant" value={edit.decoration ?? ''} onChange={e => setEdit({ ...edit, decoration: e.target.value })}>
                            {Object.entries(DECORATION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </Select>
                    </div>
                )}
            </Sheet>
            <ConfirmSheet open={!!remove} onClose={() => setRemove(null)} tone="danger" title="Supprimer cette formation ?"
                message={<p>« {remove?.title} » disparaît de l’app pour tous les membres.</p>} confirmLabel="Supprimer"
                onConfirm={async () => { await removeFormation(remove!._id); notify.success('Formation supprimée.'); qc.invalidateQueries({ queryKey: ['content', 'formations'] }); }} />
        </div>
    );
}

type PostDraft = { _id?: string; title: string; description: string; date: string; image: File | null; video: File | null; currentImage?: IFileReference };

function NewsTab() {
    const qc = useQueryClient();
    const [page, setPage] = useState(1);
    const list = useQuery({ queryKey: ['content', 'news', page], queryFn: () => getEvents({ page, limit: 10, sortBy: 'timestamp', sortOrder: 'desc' }), placeholderData: keepPreviousData });
    const [draft, setDraft] = useState<PostDraft | null>(null);
    const [remove, setRemove] = useState<IEvent | null>(null);
    const [saving, setSaving] = useState(false);
    const valid = !!draft?.title.trim() && !!draft.description.trim() && (!!draft._id || !!draft.image);

    const save = async () => {
        if (!draft || !valid) return;
        setSaving(true);
        try {
            const timestamp = draft.date ? new Date(draft.date) : undefined;
            if (draft._id) await updateEvent(draft._id, { title: draft.title.trim(), description: draft.description.trim(), timestamp, ...(draft.image ? { imageFile: draft.image } : {}), ...(draft.video ? { videoFile: draft.video } : {}) });
            else await createEvent({ title: draft.title.trim(), description: draft.description.trim(), timestamp, imageFile: draft.image!, ...(draft.video ? { videoFile: draft.video } : {}) });
            notify.success(draft._id ? 'Actualité modifiée.' : 'Actualité publiée.');
            qc.invalidateQueries({ queryKey: ['content', 'news'] });
            setDraft(null);
        } catch (e) { notify.error(errorMessage(e, 'Publication impossible.')); } finally { setSaving(false); }
    };

    return (
        <div className="space-y-3">
            <div className="flex justify-end"><Button size="sm" icon={<Plus size={16} />} onClick={() => setDraft({ title: '', description: '', date: '', image: null, video: null })}>Publier</Button></div>
            {list.isLoading ? <ListSkeleton rows={3} /> : !list.data?.events?.length ? <Card><EmptyState title="Aucune actualité" /></Card> : (
                <ul className="space-y-2">
                    {list.data.events.map(ev => (
                        <li key={ev._id}><Card className="flex gap-3">
                            {ev.image?.fileId ? <img src={thumbnailUrl(ev.image.fileId, 160)} alt="" className="size-20 rounded-tile object-cover shrink-0 bg-surface-2" /> : <div className="size-20 rounded-tile bg-surface-2 shrink-0" />}
                            <div className="min-w-0 flex-1">
                                <p className="font-semibold">{ev.title}</p>
                                <p className="text-xs text-ink-3">{formatDate(ev.timestamp ?? ev.createdAt)}{ev.video?.fileId ? ' · avec vidéo' : ''}</p>
                                <p className="text-sm text-ink-2 line-clamp-2 mt-0.5">{ev.description}</p>
                                <div className="mt-2 flex gap-2">
                                    <Button size="sm" variant="secondary" onClick={() => setDraft({ _id: ev._id, title: ev.title, description: ev.description, date: ev.timestamp ? new Date(ev.timestamp).toISOString().slice(0, 10) : '', image: null, video: null, currentImage: ev.image })}>Modifier</Button>
                                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemove(ev)}>Supprimer</Button>
                                </div>
                            </div>
                        </Card></li>
                    ))}
                </ul>
            )}
            {list.data && <Pagination page={list.data.currentPage} totalPages={list.data.totalPages} total={list.data.totalCount} onChange={setPage} />}
            <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?._id ? 'Modifier l’actualité' : 'Nouvelle actualité'} size="lg"
                footer={<Button full loading={saving} disabled={!valid} onClick={save}>{draft?._id ? 'Enregistrer' : 'Publier'}</Button>}>
                {draft && (
                    <div className="space-y-4">
                        <Input label="Titre" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
                        <Textarea label="Texte" rows={4} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} />
                        <Input label="Date affichée (facultatif)" type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} />
                        <Input label={draft._id ? 'Nouvelle image (facultatif)' : 'Image'} type="file" accept="image/*" onChange={e => setDraft({ ...draft, image: e.target.files?.[0] ?? null })}
                            hint={draft._id && draft.currentImage ? 'Laisse vide pour garder l’image actuelle.' : undefined} />
                        <Input label="Vidéo (facultatif)" type="file" accept="video/*" onChange={e => setDraft({ ...draft, video: e.target.files?.[0] ?? null })} />
                    </div>
                )}
            </Sheet>
            <ConfirmSheet open={!!remove} onClose={() => setRemove(null)} tone="danger" title="Supprimer cette actualité ?"
                message={<p>« {remove?.title} » disparaît de l’app.</p>} confirmLabel="Supprimer"
                onConfirm={async () => { await deleteEvent(remove!._id); notify.success('Actualité supprimée.'); qc.invalidateQueries({ queryKey: ['content', 'news'] }); }} />
        </div>
    );
}

const FILES = [
    { key: 'companyLogo', label: 'Logo de l’entreprise', accept: 'image/*', upload: uploadCompanyLogo },
    { key: 'termsAndConditionsPdf', label: 'Conditions générales (PDF)', accept: 'application/pdf', upload: uploadTermsPdf },
    { key: 'presentationPdf', label: 'Présentation (PDF)', accept: 'application/pdf', upload: uploadPresentationPdf },
    { key: 'presentationVideo', label: 'Vidéo de présentation', accept: 'video/*', upload: uploadPresentationVideo },
] as const;

function FilesTab() {
    const qc = useQueryClient();
    const settings = useQuery({ queryKey: ['content', 'settings'], queryFn: getSettings });
    const [pending, setPending] = useState<{ slot: typeof FILES[number]; file: File } | null>(null);
    const inputs = useRef<Record<string, HTMLInputElement | null>>({});
    if (settings.isLoading) return <ListSkeleton rows={4} />;
    return (
        <div className="space-y-2">
            {FILES.map(slot => {
                const current = settings.data?.[slot.key] as IFileReference | undefined;
                return (
                    <Card key={slot.key} className="flex items-center gap-3">
                        {slot.key === 'companyLogo' && current?.fileId
                            ? <img src={thumbnailUrl(current.fileId, 96)} alt="" className="size-12 rounded-tile object-contain bg-surface-2" />
                            : <span className="size-12 grid place-items-center rounded-tile bg-surface-2 text-ink-3"><FileText size={20} /></span>}
                        <div className="min-w-0 flex-1">
                            <p className="font-semibold">{slot.label}</p>
                            {current?.fileId
                                ? <a href={streamUrl(current)} target="_blank" rel="noreferrer" className="text-sm text-primary inline-flex items-center gap-1 truncate max-w-full">{current.fileName || 'Ouvrir le fichier'}<ExternalLink size={12} /></a>
                                : <p className="text-sm text-ink-3">Aucun fichier</p>}
                        </div>
                        <input ref={el => { inputs.current[slot.key] = el; }} type="file" accept={slot.accept} className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) setPending({ slot, file: f }); e.target.value = ''; }} />
                        <Button size="sm" variant="secondary" onClick={() => inputs.current[slot.key]?.click()}>{current?.fileId ? 'Remplacer' : 'Ajouter'}</Button>
                    </Card>
                );
            })}
            <ConfirmSheet open={!!pending} onClose={() => setPending(null)} title={`Remplacer : ${pending?.slot.label} ?`}
                message={<p>« {pending?.file.name} » remplacera le fichier actuel pour tous les membres.</p>} confirmLabel="Remplacer"
                onConfirm={async () => { await pending!.slot.upload(pending!.file); notify.success('Fichier remplacé.'); qc.invalidateQueries({ queryKey: ['content', 'settings'] }); }} />
        </div>
    );
}

function GroupsTab() {
    const qc = useQueryClient();
    const settings = useQuery({ queryKey: ['content', 'settings'], queryFn: getSettings });
    const [form, setForm] = useState({ whatsappGroupUrl: '', telegramGroupUrl: '', discordGroupUrl: '' });
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        if (settings.data) setForm({ whatsappGroupUrl: settings.data.whatsappGroupUrl ?? '', telegramGroupUrl: settings.data.telegramGroupUrl ?? '', discordGroupUrl: settings.data.discordGroupUrl ?? '' });
    }, [settings.data]);
    const bad = (v: string) => v && !/^https?:\/\//.test(v) ? 'Le lien doit commencer par https://' : undefined;
    const valid = !bad(form.whatsappGroupUrl) && !bad(form.telegramGroupUrl) && !bad(form.discordGroupUrl);
    const save = async () => {
        setSaving(true);
        try { await updateSettings({ whatsappGroupUrl: form.whatsappGroupUrl.trim(), telegramGroupUrl: form.telegramGroupUrl.trim(), discordGroupUrl: form.discordGroupUrl.trim() }); notify.success('Liens enregistrés.'); qc.invalidateQueries({ queryKey: ['content', 'settings'] }); }
        catch (e) { notify.error(errorMessage(e, 'Enregistrement impossible.')); } finally { setSaving(false); }
    };
    if (settings.isLoading) return <ListSkeleton rows={3} />;
    return (
        <Card className="space-y-4">
            <SectionTitle>Groupes de la communauté</SectionTitle>
            <Input label="Groupe WhatsApp" type="url" value={form.whatsappGroupUrl} onChange={e => setForm({ ...form, whatsappGroupUrl: e.target.value })} error={bad(form.whatsappGroupUrl)} placeholder="https://chat.whatsapp.com/…" />
            <Input label="Groupe Telegram" type="url" value={form.telegramGroupUrl} onChange={e => setForm({ ...form, telegramGroupUrl: e.target.value })} error={bad(form.telegramGroupUrl)} placeholder="https://t.me/…" />
            <Input label="Serveur Discord" type="url" value={form.discordGroupUrl} onChange={e => setForm({ ...form, discordGroupUrl: e.target.value })} error={bad(form.discordGroupUrl)} placeholder="https://discord.gg/…" />
            <Button full loading={saving} disabled={!valid} onClick={save}>Enregistrer</Button>
        </Card>
    );
}

/** What members see in the app that admins write: courses, news, documents, group links. */
export default function ContentPage() {
    const [tab, setTab] = useParamState('onglet', 'formations');
    return (
        <Page title="Contenu de l’app" back="/plus" width="narrow">
            <div className="space-y-4">
                <Tabs value={tab} onChange={setTab} phoneColumns={2} items={[
                    { value: 'formations', label: 'Formations' }, { value: 'actualites', label: 'Actualités' },
                    { value: 'fichiers', label: 'Fichiers' }, { value: 'groupes', label: 'Groupes' },
                ]} />
                {tab === 'actualites' ? <NewsTab /> : tab === 'fichiers' ? <FilesTab /> : tab === 'groupes' ? <GroupsTab /> : <FormationsTab />}
            </div>
        </Page>
    );
}
