import { useEffect, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, Image01Icon, SentIcon, Video01Icon } from '@hugeicons/core-free-icons';
import type { StatusCategory } from '../../services/statusApi';
import { Button, Dialog, DialogClose, Field, Select, SheetContent, Textarea } from '../ui';

const MAX = 2000;

export interface StatusDraft { category: string; content: string; media: File | null }

/** Publish a story as the SBC team: category, text, optional photo or video. */
export function StatusComposerSheet({ open, onOpenChange, categories, publishing, onPublish }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Categories this account may post in. */
    categories: StatusCategory[];
    publishing: boolean;
    /** Resolves true when the story was published (the form is then emptied). */
    onPublish: (draft: StatusDraft) => Promise<boolean>;
}) {
    const [draft, setDraft] = useState<StatusDraft>({ category: '', content: '', media: null });
    const preview = useMemo(() => (draft.media ? URL.createObjectURL(draft.media) : null), [draft.media]);
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

    const ready = !!draft.category && !!draft.content.trim() && !publishing;
    const submit = async () => {
        if (!ready) return;
        if (await onPublish(draft)) setDraft({ category: '', content: '', media: null });
    };
    const close = (next: boolean) => {
        if (publishing) return;
        if (!next) setDraft({ category: '', content: '', media: null });
        onOpenChange(next);
    };
    const pick = (file: File | null | undefined) => setDraft(d => ({ ...d, media: file ?? null }));

    return (
        <Dialog open={open} onOpenChange={close}>
            <SheetContent
                title="Publier une story"
                description="Elle apparaît dans le fil des membres pendant 24 heures, au nom de l’équipe SBC."
                footer={(
                    <>
                        <DialogClose asChild><Button variant="outline" size="lg" disabled={publishing}>Annuler</Button></DialogClose>
                        <Button variant="primary" size="lg" onClick={() => void submit()} disabled={!ready} loading={publishing}>
                            {!publishing && <HugeiconsIcon icon={SentIcon} size={16} aria-hidden="true" />}
                            Publier la story
                        </Button>
                    </>
                )}
            >
                <form className="space-y-4" onSubmit={e => { e.preventDefault(); void submit(); }}>
                    <Field label="Catégorie" required>
                        <Select
                            value={draft.category}
                            onValueChange={category => setDraft(d => ({ ...d, category }))}
                            placeholder="Choisir une catégorie…"
                            options={categories.map(c => ({ value: c.key, label: c.nameFr || c.nameEn }))}
                            className="h-11"
                        />
                    </Field>
                    <Field label="Texte" required help={<span className="tabular-nums">{draft.content.length} / {MAX} caractères</span>}>
                        <Textarea
                            value={draft.content}
                            onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
                            placeholder="Ce que les membres doivent lire…"
                            rows={5}
                            maxLength={MAX}
                        />
                    </Field>
                    <div className="space-y-2">
                        <p className="text-sm font-medium text-fg">Photo ou vidéo <span className="font-normal text-fg-muted">(facultatif)</span></p>
                        {draft.media && preview ? (
                            <div className="relative overflow-hidden rounded-panel border border-line bg-[oklch(0.15_0.02_258)]">
                                {draft.media.type.startsWith('video/')
                                    ? <video src={preview} className="max-h-72 w-full object-contain" autoPlay loop muted playsInline />
                                    : <img src={preview} alt="Aperçu de la story" className="max-h-72 w-full object-contain" />}
                                <Button type="button" variant="outline" size="lg" className="absolute right-2 top-2" onClick={() => pick(null)}>
                                    <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" /> Retirer
                                </Button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-line-strong bg-surface text-sm font-medium text-fg hover:bg-surface-2 focus-within:outline-2 focus-within:outline-primary">
                                    <HugeiconsIcon icon={Image01Icon} size={18} aria-hidden="true" /> Photo
                                    <input type="file" accept="image/*" className="sr-only" onChange={e => pick(e.target.files?.[0])} />
                                </label>
                                <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-line-strong bg-surface text-sm font-medium text-fg hover:bg-surface-2 focus-within:outline-2 focus-within:outline-primary">
                                    <HugeiconsIcon icon={Video01Icon} size={18} aria-hidden="true" /> Vidéo
                                    <input type="file" accept="video/*" className="sr-only" onChange={e => pick(e.target.files?.[0])} />
                                </label>
                            </div>
                        )}
                    </div>
                </form>
            </SheetContent>
        </Dialog>
    );
}
