import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, DialogContent, Field, Input, Select, Textarea } from '../ui';
import { Notice } from '../moduleKit';
import {
    SHOWCASE_KIND_LABELS, httpsUrlError, photoUrl, postShowcaseUpdate, readImpactError, uploadShowcaseImage,
    type ShowcaseUpdateKind,
} from '../../services/impactV2Api';

type Key = 'title' | 'body' | 'link' | 'imageFileId';

/** « Publier une nouvelle »: published at once on the page (the finalists' own go through validation). */
export default function ShowcaseNewsDialog({ showcaseId, onClose, onPublished }: { showcaseId: string; onClose: () => void; onPublished: () => void }) {
    const [kind, setKind] = useState<ShowcaseUpdateKind>('NEWS');
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [link, setLink] = useState('');
    const [imageFileId, setImageFileId] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
    const [error, setError] = useState<string | null>(null);

    const upload = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) { setErrors(e => ({ ...e, imageFileId: 'Choisissez une image.' })); return; }
        setUploading(true);
        setErrors(e => ({ ...e, imageFileId: undefined }));
        try {
            setImageFileId(await uploadShowcaseImage(file));
        } catch (err) {
            setErrors(e => ({ ...e, imageFileId: readImpactError(err, 'L’image n’a pas pu être envoyée.').message }));
        } finally {
            setUploading(false);
        }
    };

    const publish = async () => {
        const errs: Partial<Record<Key, string>> = {};
        const t = title.trim();
        const b = body.trim();
        if (t.length < 3 || t.length > 120) errs.title = 'Le titre compte 3 à 120 caractères.';
        if (b.length < 20 || b.length > 3000) errs.body = 'Le texte compte 20 à 3 000 caractères.';
        const linkError = httpsUrlError(link);
        if (linkError) errs.link = linkError;
        setErrors(errs);
        if (Object.keys(errs).length) return;
        setSaving(true);
        setError(null);
        try {
            await postShowcaseUpdate(showcaseId, { kind, title: t, body: b, ...(imageFileId ? { imageFileId } : {}), ...(link.trim() ? { link: link.trim() } : {}) });
            toast.success('Nouvelle publiée sur la page.');
            onPublished();
        } catch (err) {
            // HIDDEN / ARCHIVED (the page changed since it was opened) and the rest: the server's message.
            const x = readImpactError(err, 'La nouvelle n’a pas pu être publiée.');
            const field = x.fields[0] as Key | undefined;
            if (field && ['title', 'body', 'link', 'imageFileId'].includes(field)) setErrors({ [field]: x.message });
            else setError(x.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={o => { if (!o && !saving && !uploading) onClose(); }}>
            <DialogContent
                size="lg"
                title="Publier une nouvelle"
                description="Elle apparaît tout de suite sur la page SBC Impact."
                footer={(
                    <>
                        <Button variant="outline" size="lg" onClick={onClose} disabled={saving}>Annuler</Button>
                        <Button variant="primary" size="lg" onClick={() => void publish()} loading={saving} disabled={uploading}>Publier</Button>
                    </>
                )}
            >
                <div className="space-y-4">
                    <Field label="Type">
                        <Select className="h-11 sm:h-9" value={kind} onValueChange={v => setKind(v as ShowcaseUpdateKind)}
                            options={(Object.keys(SHOWCASE_KIND_LABELS) as ShowcaseUpdateKind[]).map(k => ({ value: k, label: SHOWCASE_KIND_LABELS[k] }))} />
                    </Field>
                    <Field label="Titre" required error={errors.title}>
                        <Input className="h-11 sm:h-9" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} />
                    </Field>
                    <Field label="Texte" required error={errors.body} help={`${body.trim().length} / 3 000 caractères (20 au moins).`}>
                        <Textarea rows={6} value={body} onChange={e => setBody(e.target.value)} maxLength={3000} />
                    </Field>
                    <Field label="Image" error={errors.imageFileId} help={uploading ? 'Envoi de l’image…' : 'Facultative.'}>
                        <Input type="file" accept="image/*" className="h-11 py-2 sm:h-9 sm:py-1" onChange={e => void upload(e.target.files?.[0])} disabled={uploading} />
                    </Field>
                    {imageFileId && (
                        <div className="flex items-center gap-3">
                            <img src={photoUrl(imageFileId, 240)} alt="Aperçu" className="h-24 rounded-panel border border-line object-cover" />
                            <Button variant="ghost" size="sm" onClick={() => setImageFileId(null)}>Retirer l’image</Button>
                        </div>
                    )}
                    <Field label="Lien" error={errors.link} help="Facultatif, https://…">
                        <Input type="url" inputMode="url" className="h-11 sm:h-9" value={link} onChange={e => setLink(e.target.value)} placeholder="https://" />
                    </Field>
                    {error && <Notice tone="danger">{error}</Notice>}
                </div>
            </DialogContent>
        </Dialog>
    );
}
