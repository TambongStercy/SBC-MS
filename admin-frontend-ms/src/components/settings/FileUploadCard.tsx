import { useEffect, useState } from 'react';
import type { Accept } from 'react-dropzone';
import { toast } from 'sonner';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { CloudUploadIcon, LinkSquare02Icon } from '@hugeicons/core-free-icons';
import apiClient from '../../api/apiClient';
import type { ISettings } from '../../services/adminSettingsApi';
import { getFileUrl } from '../../utils/fileUtils';
import { ImageDisplay } from '../common/ImageDisplay';
import { Can } from '../Can';
import { Button, Panel, PanelBody, PanelHeader } from '../ui';
import { apiError, fmtBytes } from '../display/format';
import { FileDrop } from './FileDrop';

type FileKey = 'companyLogo' | 'termsAndConditionsPdf' | 'presentationVideo' | 'presentationPdf';

/**
 * Upload names were stored as latin1-read UTF-8 ("PrÃ©sentation"): show them
 * as typed. Names that are not mangled are left as they are.
 */
const readableName = (name?: string) => {
    if (!name || !/[ÃÂâ]/.test(name)) return name;
    try {
        const bytes = Uint8Array.from(Array.from(name), c => c.charCodeAt(0) & 0xff);
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return name;
    }
};

const kindOf = (mime?: string): 'image' | 'video' | 'pdf' | 'other' => {
    if (!mime) return 'other';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime === 'application/pdf') return 'pdf';
    return 'other';
};

/**
 * One official file members see (logo, CGU, presentation…): what is online
 * now, and how to replace it. Replacing is immediate for every member.
 */
export function FileUploadCard({ title, description, icon, current, upload, onUploaded, accept, hint }: {
    title: string;
    description: string;
    icon: IconSvgElement;
    current: ISettings[FileKey];
    upload: (file: File) => Promise<ISettings>;
    onUploaded: (settings: ISettings) => void;
    accept: Accept;
    hint: string;
}) {
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Local preview of the picked image or video, released when it changes.
    useEffect(() => {
        if (!file || !(file.type.startsWith('image/') || file.type.startsWith('video/'))) { setPreview(null); return; }
        const url = URL.createObjectURL(file);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    const currentUrl = current?.fileId ? getFileUrl(current.fileId, `${apiClient.defaults.baseURL || ''}/settings/files`) : null;
    const kind = kindOf(current?.mimeType);

    const send = async () => {
        if (!file) return;
        setUploading(true);
        setError(null);
        try {
            const updated = await upload(file);
            onUploaded(updated);
            setFile(null);
            toast.success(`${title} : mis à jour.`);
        } catch (err) {
            const message = apiError(err, `L’envoi a échoué : ${title}.`);
            setError(message);
            toast.error(message);
        } finally {
            setUploading(false);
        }
    };

    return (
        <Panel className="flex flex-col">
            <PanelHeader
                title={<span className="flex items-center gap-2"><HugeiconsIcon icon={icon} size={16} className="text-fg-muted" aria-hidden="true" />{title}</span>}
                description={description}
            />
            <PanelBody className="flex flex-1 flex-col gap-4">
                <div>
                    <p className="mb-2 text-xs font-medium text-fg-muted">En ligne actuellement</p>
                    {currentUrl ? (
                        <div className="flex items-start gap-3 rounded-control border border-line bg-surface-2 p-3">
                            {kind === 'image' && current?.fileId && (
                                <ImageDisplay fileId={current.fileId} alt={`${title} actuel`} className="h-16 w-16 shrink-0 rounded-md bg-surface object-contain" />
                            )}
                            {kind === 'video' && <video src={currentUrl} controls preload="metadata" className="h-20 w-auto max-w-[45%] shrink-0 rounded-md" />}
                            <div className="min-w-0 flex-1 text-sm">
                                <a href={currentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 font-medium text-primary hover:underline">
                                    <span className="truncate">{readableName(current?.fileName) || 'Ouvrir le fichier'}</span>
                                    <HugeiconsIcon icon={LinkSquare02Icon} size={14} className="shrink-0" aria-hidden="true" />
                                </a>
                                <p className="mt-0.5 text-xs text-fg-muted">
                                    {[current?.size ? fmtBytes(current.size) : null, current?.mimeType].filter(Boolean).join(' · ')}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <p className="rounded-control border border-dashed border-line px-3 py-3 text-sm text-fg-muted">Aucun fichier en ligne pour le moment.</p>
                    )}
                </div>

                <Can module="settings" write>
                    <div className="mt-auto space-y-3">
                        <FileDrop accept={accept} file={file} onFile={f => { setFile(f); setError(null); }} hint={hint} disabled={uploading} />
                        {preview && file?.type.startsWith('image/') && <img src={preview} alt="Aperçu du fichier choisi" className="max-h-28 rounded-md border border-line" />}
                        {preview && file?.type.startsWith('video/') && <video src={preview} controls className="max-h-32 rounded-md border border-line" />}
                        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            {file && <Button variant="ghost" size="lg" onClick={() => setFile(null)} disabled={uploading}>Annuler</Button>}
                            <Button variant="primary" size="lg" onClick={send} disabled={!file} loading={uploading}>
                                {!uploading && <HugeiconsIcon icon={CloudUploadIcon} size={16} aria-hidden="true" />}
                                {currentUrl ? 'Remplacer le fichier' : 'Mettre en ligne'}
                            </Button>
                        </div>
                    </div>
                </Can>
            </PanelBody>
        </Panel>
    );
}
