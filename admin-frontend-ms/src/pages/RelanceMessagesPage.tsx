import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    Alert02Icon, Delete02Icon, File01Icon, FloppyDiskIcon, Image01Icon, Upload04Icon, Video01Icon, ViewIcon, ViewOffSlashIcon,
} from '@hugeicons/core-free-icons';
import {
    deactivateMessage, getAllMessages, previewMessage, uploadMediaFile, upsertMessage, type RelanceButton, type RelanceMessage,
} from '../services/adminRelanceApi';
import { usePermission } from '../hooks/usePermission';
import { Can } from '../components/Can';
import {
    Badge, Button, Dialog, DialogClose, DialogContent, Field, Input, PageHeader, Panel, PanelBody, PanelHeader, Skeleton, Switch,
    Tabs, TabsContent, TabsList, TabsTrigger, Textarea,
} from '../components/ui';
import { cn } from '../lib/cn';
import { ErrorState } from '../components/display/ErrorState';
import { apiError } from '../components/display/format';
import { useUrlParams } from '../components/display/useUrlParams';
import { ButtonsEditor } from '../components/relance/ButtonsEditor';

type Media = RelanceMessage['mediaUrls'][number];
interface Draft { subject: string; fr: string; en: string; media: Media[]; buttons: RelanceButton[]; active: boolean }

const DAYS = [1, 2, 3, 4, 5, 6, 7];
const VARIABLES = [
    { code: '{{name}}', label: 'Prénom du filleul' },
    { code: '{{referrerName}}', label: 'Nom du parrain' },
    { code: '{{day}}', label: 'Jour (1 à 7)' },
];
const MEDIA_ICON = { image: Image01Icon, video: Video01Icon, pdf: File01Icon } as const;
const MEDIA_LABEL = { image: 'Image', video: 'Vidéo', pdf: 'PDF' } as const;

const toDraft = (m?: RelanceMessage): Draft => ({
    subject: m?.subject ?? '',
    fr: m?.messageTemplate.fr ?? '',
    en: m?.messageTemplate.en ?? '',
    media: m?.mediaUrls ?? [],
    buttons: m?.buttons ?? [],
    active: m?.active ?? true,
});
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The 7 e-mails of the relance journey (J1 → J7), shared by « relance des
 * nouveaux » and the campaigns. One day at a time: subject, text in French
 * and English, buttons, attachments; preview renders the real e-mail.
 */
export default function RelanceMessagesPage() {
    const queryClient = useQueryClient();
    const canWrite = usePermission('relance') === 'write';
    const url = useUrlParams({ jour: '1' });
    const day = Math.min(7, Math.max(1, Number(url.get('jour')) || 1));

    const messages = useQuery({ queryKey: ['relance-messages'], queryFn: getAllMessages });
    const saved = useMemo(() => messages.data?.find(m => m.dayNumber === day), [messages.data, day]);
    // Unsaved edits of the shown day; without any, the form shows the saved e-mail.
    const [edits, setEdits] = useState<{ day: number; draft: Draft } | null>(null);
    const [lang, setLang] = useState<'fr' | 'en'>('fr');
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [confirmOff, setConfirmOff] = useState(false);
    const [pendingDay, setPendingDay] = useState<number | null>(null);
    const textRefs = { fr: useRef<HTMLTextAreaElement>(null), en: useRef<HTMLTextAreaElement>(null) };

    const base = toDraft(saved);
    const draft = edits && edits.day === day ? edits.draft : base;
    const dirty = !same(draft, base);
    const update = (fn: (d: Draft) => Draft) => setEdits(e => ({ day, draft: fn(e && e.day === day ? e.draft : base) }));
    const set = (patch: Partial<Draft>) => update(d => ({ ...d, ...patch }));

    const goTo = (d: number) => {
        if (d === day) return;
        if (dirty) { setPendingDay(d); return; }
        setEdits(null);
        url.set({ jour: String(d) });
    };

    const insertVariable = (code: string) => {
        const el = textRefs[lang].current;
        const value = draft[lang];
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? value.length;
        set({ [lang]: value.slice(0, start) + code + value.slice(end) } as Partial<Draft>);
        requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + code.length, start + code.length); });
    };

    const save = async () => {
        if (!draft.fr.trim() || !draft.en.trim()) { toast.error('Le texte en français et en anglais est obligatoire.'); return; }
        if (draft.buttons.some(b => !b.label.trim() || !b.url.trim())) { toast.error('Chaque bouton a besoin d’un texte et d’un lien.'); return; }
        setSaving(true);
        try {
            await upsertMessage({
                dayNumber: day,
                subject: draft.subject.trim() || undefined,
                messageTemplate: { fr: draft.fr, en: draft.en },
                mediaUrls: draft.media,
                buttons: draft.buttons,
                variables: VARIABLES.map(v => v.code),
                active: draft.active,
            });
            toast.success(`E-mail du jour ${day} enregistré.`);
            await queryClient.invalidateQueries({ queryKey: ['relance-messages'] });
            setEdits(null);
        } catch (error) {
            toast.error(apiError(error, 'L’e-mail n’a pas pu être enregistré.'));
        } finally {
            setSaving(false);
        }
    };

    const deactivate = async () => {
        setSaving(true);
        try {
            await deactivateMessage(day);
            toast.success(`E-mail du jour ${day} désactivé.`);
            setConfirmOff(false);
            await queryClient.invalidateQueries({ queryKey: ['relance-messages'] });
            setEdits(null);
        } catch (error) {
            toast.error(apiError(error, 'L’e-mail n’a pas pu être désactivé.'));
        } finally {
            setSaving(false);
        }
    };

    const upload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > 50 * 1024 * 1024) { toast.error('Le fichier doit faire moins de 50 Mo.'); return; }
        setUploading(true);
        try {
            const up = await uploadMediaFile(file);
            update(d => ({ ...d, media: [...d.media, { url: up.url, type: up.type, filename: up.filename }] }));
            toast.success(`${file.name} ajouté. Pensez à enregistrer.`);
        } catch (error) {
            toast.error(apiError(error, 'Le fichier n’a pas pu être envoyé.'));
        } finally {
            setUploading(false);
        }
    };

    const showPreview = async () => {
        if (!draft.fr.trim()) { toast.error('Écrivez le texte en français pour voir l’aperçu.'); return; }
        setPreviewing(true);
        try {
            setPreview(await previewMessage({
                dayNumber: day,
                subject: draft.subject.trim() || undefined,
                messageTemplate: { fr: draft.fr, en: draft.en },
                mediaUrls: draft.media.map(m => ({ url: m.url, type: m.type })),
                buttons: draft.buttons.filter(b => b.label.trim() && b.url.trim()),
                recipientName: 'Marie Nguema',
                referrerName: 'Paul Mbarga',
            }));
        } catch (error) {
            toast.error(apiError(error, 'L’aperçu n’a pas pu être créé.'));
        } finally {
            setPreviewing(false);
        }
    };

    const dayState = (d: number) => {
        const m = messages.data?.find(x => x.dayNumber === d);
        return !m ? 'missing' : m.active ? 'on' : 'off';
    };

    const actions = (sticky: boolean) => (
        <>
            <Button size="lg" className={sticky ? 'flex-1' : undefined} onClick={() => void showPreview()} loading={previewing}>
                {!previewing && <HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" />}
                Aperçu
            </Button>
            <Can module="relance" write>
                <Button variant="primary" size="lg" className={sticky ? 'flex-1' : undefined} onClick={() => void save()} loading={saving} disabled={!dirty && !!saved}>
                    {!saving && <HugeiconsIcon icon={FloppyDiskIcon} size={16} aria-hidden="true" />}
                    Enregistrer
                </Button>
            </Can>
        </>
    );

    if (messages.isError) {
        return (
            <div className="space-y-6">
                <PageHeader title="E-mails de relance" />
                <Panel><ErrorState message={apiError(messages.error, 'Les e-mails n’ont pas pu être chargés.')} onRetry={() => void messages.refetch()} retrying={messages.isFetching} /></Panel>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-24 md:pb-0">
            <PageHeader
                title="E-mails de relance"
                description="L’e-mail que reçoit un filleul chaque jour de sa relance (J1 à J7), pour la relance des nouveaux comme pour les campagnes."
                actions={<div className="hidden gap-2 md:flex">{actions(false)}</div>}
            />

            <Panel>
                <div className="grid grid-cols-7 gap-1 p-2" role="tablist" aria-label="Jour de la relance">
                    {DAYS.map(d => {
                        const st = dayState(d);
                        const on = d === day;
                        return (
                            <button
                                key={d}
                                type="button"
                                role="tab"
                                aria-selected={on}
                                onClick={() => goTo(d)}
                                className={cn(
                                    'flex min-h-14 flex-col items-center justify-center gap-1 rounded-control px-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary',
                                    on ? 'bg-primary-soft text-primary' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                                )}
                            >
                                <span>J{d}</span>
                                <span className="flex items-center gap-1 text-[11px] font-normal">
                                    <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', st === 'on' ? 'bg-success' : st === 'off' ? 'bg-warning' : 'bg-line-strong')} />
                                    <span className="hidden sm:inline">{st === 'on' ? 'Envoyé' : st === 'off' ? 'Coupé' : 'Vide'}</span>
                                    <span className="sr-only sm:hidden">{st === 'on' ? 'envoyé' : st === 'off' ? 'coupé' : 'vide'}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </Panel>

            {messages.isLoading ? (
                <div className="space-y-4"><Skeleton className="h-64 w-full" /><Skeleton className="h-40 w-full" /></div>
            ) : (
                <fieldset disabled={!canWrite} className="min-w-0 space-y-6">
                    {saved && !saved.active && (
                        <Panel className="border-warning/40 bg-warning-soft/40" role="status">
                            <div className="flex gap-3 px-4 py-3 sm:px-5">
                                <HugeiconsIcon icon={Alert02Icon} size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
                                <p className="text-sm text-fg">
                                    Le jour {day} est coupé : les filleuls qui arrivent à ce jour y restent bloqués (l’envoi ne passe pas au jour suivant).
                                    Réactivez-le dès que possible.
                                </p>
                            </div>
                        </Panel>
                    )}

                    <Panel>
                        <PanelHeader
                            title={`E-mail du jour ${day}`}
                            description={saved ? (dirty ? 'Modifications non enregistrées.' : 'Enregistré.') : 'Pas encore configuré : il sera créé à l’enregistrement.'}
                            actions={(
                                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg md:min-h-0">
                                    <Switch checked={draft.active} onCheckedChange={v => set({ active: v })} aria-label="E-mail envoyé" />
                                    Envoyé
                                </label>
                            )}
                        />
                        <PanelBody className="space-y-4">
                            <Field label="Objet de l’e-mail" help="Facultatif : laissez vide pour l’objet automatique.">
                                <Input value={draft.subject} onChange={e => set({ subject: e.target.value })} placeholder="Objet personnalisé" className="h-11 md:h-9" />
                            </Field>

                            <Tabs value={lang} onValueChange={v => setLang(v as 'fr' | 'en')}>
                                <TabsList className="pb-px [scrollbar-width:none]">
                                    <TabsTrigger value="fr">Français{!draft.fr.trim() && <Badge tone="danger" className="ml-2">à écrire</Badge>}</TabsTrigger>
                                    <TabsTrigger value="en">Anglais{!draft.en.trim() && <Badge tone="danger" className="ml-2">à écrire</Badge>}</TabsTrigger>
                                </TabsList>
                                {(['fr', 'en'] as const).map(l => (
                                    <TabsContent key={l} value={l} className="pt-3">
                                        <Field label={l === 'fr' ? 'Texte en français' : 'Texte en anglais'} required>
                                            <Textarea ref={textRefs[l]} value={draft[l]} onChange={e => set({ [l]: e.target.value } as Partial<Draft>)} rows={12} />
                                        </Field>
                                    </TabsContent>
                                ))}
                            </Tabs>

                            <div>
                                <p className="mb-2 text-xs text-fg-muted">Insérer à l’endroit du curseur :</p>
                                <div className="flex flex-wrap gap-2">
                                    {VARIABLES.map(v => (
                                        <Button key={v.code} size="sm" className="h-11 md:h-8" onClick={() => insertVariable(v.code)} title={v.code}>
                                            {v.label}
                                            <code className="font-mono text-[11px] text-fg-muted">{v.code}</code>
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        </PanelBody>
                    </Panel>

                    <Panel>
                        <PanelHeader title="Boutons d’action" description="Par exemple « Payer maintenant » vers la page de paiement." />
                        <PanelBody>
                            <ButtonsEditor buttons={draft.buttons} onChange={b => set({ buttons: b })} disabled={!canWrite} />
                        </PanelBody>
                    </Panel>

                    <Panel>
                        <PanelHeader title="Pièces jointes" description="Images, vidéos ou PDF, 50 Mo au plus." />
                        <PanelBody className="space-y-3">
                            {draft.media.length > 0 && (
                                <ul className="divide-y divide-line rounded-panel border border-line">
                                    {draft.media.map((m, i) => {
                                        const local = /localhost|127\.0\.0\.1/.test(m.url);
                                        return (
                                            <li key={`${m.url}-${i}`} className="flex items-center gap-3 px-3 py-2">
                                                <HugeiconsIcon icon={MEDIA_ICON[m.type] ?? File01Icon} size={18} className="shrink-0 text-fg-muted" aria-hidden="true" />
                                                <div className="min-w-0 flex-1">
                                                    <a href={m.url} target="_blank" rel="noreferrer" className="block truncate text-sm text-fg hover:underline">{m.filename || m.url}</a>
                                                    <p className="text-xs text-fg-muted">
                                                        {MEDIA_LABEL[m.type] ?? m.type}
                                                        {local && <span className="text-danger"> · adresse locale, illisible dans une boîte mail</span>}
                                                    </p>
                                                </div>
                                                {canWrite && (
                                                    <Button variant="danger-ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9" aria-label={`Retirer ${m.filename || 'le fichier'}`} onClick={() => set({ media: draft.media.filter((_, j) => j !== i) })}>
                                                        <HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />
                                                    </Button>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                            <Can module="relance" write>
                                <Button asChild size="lg" className={cn(uploading && 'pointer-events-none opacity-60')}>
                                    <label>
                                        <HugeiconsIcon icon={Upload04Icon} size={16} aria-hidden="true" />
                                        {uploading ? 'Envoi…' : 'Ajouter un fichier'}
                                        <input type="file" accept="image/*,video/*,.pdf" className="sr-only" onChange={e => void upload(e)} disabled={uploading} />
                                    </label>
                                </Button>
                            </Can>
                        </PanelBody>
                    </Panel>

                    {saved && saved.active && (
                        <Can module="relance" write>
                            <div className="flex justify-end">
                                <Button variant="danger-ghost" size="lg" onClick={() => setConfirmOff(true)}>
                                    <HugeiconsIcon icon={ViewOffSlashIcon} size={16} aria-hidden="true" />
                                    Couper l’e-mail du jour {day}
                                </Button>
                            </div>
                        </Can>
                    )}
                </fieldset>
            )}

            {/* Phones: the two actions stay under the thumb, just above the shell's bottom bar (the shell content is not a sticky container). */}
            <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 flex gap-2 border-t border-line bg-surface px-4 py-3 md:hidden">
                {actions(true)}
            </div>

            <Dialog open={!!preview} onOpenChange={o => { if (!o) setPreview(null); }}>
                {preview && (
                    <DialogContent size="lg" title={`Aperçu de l’e-mail du jour ${day}`} description="Avec un filleul et un parrain fictifs.">
                        <div className="overflow-hidden rounded-md border border-line bg-white">
                            <iframe srcDoc={preview} title="Aperçu de l’e-mail" sandbox="allow-same-origin" className="h-[65dvh] w-full border-0" />
                        </div>
                    </DialogContent>
                )}
            </Dialog>

            <Dialog open={confirmOff} onOpenChange={o => { if (!o && !saving) setConfirmOff(false); }}>
                <DialogContent
                    size="sm"
                    title={`Couper l’e-mail du jour ${day} ?`}
                    description="Plus aucun e-mail ne partira pour ce jour."
                    footer={(
                        <>
                            <DialogClose asChild><Button size="lg" disabled={saving}>Annuler</Button></DialogClose>
                            <Button variant="danger" size="lg" loading={saving} onClick={() => void deactivate()}>Couper</Button>
                        </>
                    )}
                >
                    <p className="text-sm text-fg-muted">
                        Attention : les filleuls qui arrivent au jour {day} y restent bloqués tant qu’il est coupé, ils ne reçoivent pas non plus les jours suivants.
                    </p>
                </DialogContent>
            </Dialog>

            <Dialog open={pendingDay !== null} onOpenChange={o => { if (!o) setPendingDay(null); }}>
                <DialogContent
                    size="sm"
                    title="Quitter sans enregistrer ?"
                    description={`Les modifications du jour ${day} seront perdues.`}
                    footer={(
                        <>
                            <DialogClose asChild><Button size="lg">Rester</Button></DialogClose>
                            <Button variant="danger" size="lg" onClick={() => { if (pendingDay) { setEdits(null); url.set({ jour: String(pendingDay) }); } setPendingDay(null); }}>Quitter</Button>
                        </>
                    )}
                />
            </Dialog>
        </div>
    );
}
