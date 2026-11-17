import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';

/** The pop-up as a member sees it in the app (same layout as the member app's window). */
export function PopupPreview({ title, message, imageUrl, buttonLabel }: {
    title: string; message: string; imageUrl?: string; buttonLabel?: string;
}) {
    return (
        <div className="rounded-panel border border-line bg-surface-2 p-3">
            <div className="relative mx-auto w-full max-w-xs overflow-hidden rounded-panel border border-line bg-surface text-left">
                <span className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 text-fg-muted" aria-hidden="true">
                    <HugeiconsIcon icon={Cancel01Icon} size={14} />
                </span>
                {imageUrl && <img src={imageUrl} alt="" className="max-h-40 w-full object-cover" />}
                <div className="p-4">
                    <p className="pr-8 text-base font-bold text-fg">{title || 'Titre de l’annonce'}</p>
                    <p className="mt-1.5 whitespace-pre-line text-sm text-fg-muted">{message || 'Le message apparaît ici.'}</p>
                    {buttonLabel && (
                        <span className="mt-4 flex h-11 w-full items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-fg">{buttonLabel}</span>
                    )}
                    <span className="mt-2 flex h-10 w-full items-center justify-center text-sm font-semibold text-fg-muted">Fermer</span>
                </div>
            </div>
        </div>
    );
}
