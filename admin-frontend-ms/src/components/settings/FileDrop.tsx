import { useCallback } from 'react';
import { useDropzone, type Accept, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { CloudUploadIcon } from '@hugeicons/core-free-icons';
import { cn } from '../../lib/cn';
import { fmtBytes } from '../display/format';

const REJECTION_LABEL: Record<string, string> = {
    'file-invalid-type': 'Ce type de fichier n’est pas accepté ici.',
    'file-too-large': 'Ce fichier est trop lourd.',
    'too-many-files': 'Un seul fichier à la fois.',
};

/**
 * One file picked by drag-and-drop or by tapping the zone (44 px+ target).
 * Shows the chosen file's name and size once picked.
 */
export function FileDrop({ accept, file, onFile, hint, disabled, id }: {
    accept: Accept;
    file: File | null;
    onFile: (file: File | null) => void;
    /** Accepted formats, in words. */
    hint: string;
    disabled?: boolean;
    id?: string;
}) {
    const onDrop = useCallback((accepted: File[], rejected: FileRejection[]) => {
        if (accepted[0]) onFile(accepted[0]);
        if (rejected.length) {
            const code = rejected[0].errors[0]?.code;
            toast.error(REJECTION_LABEL[code] ?? rejected[0].errors[0]?.message ?? 'Fichier non valide.');
        }
    }, [onFile]);
    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept, maxFiles: 1, disabled });

    return (
        <div
            {...getRootProps()}
            className={cn(
                'flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-control border border-dashed border-line-strong px-4 py-5 text-center transition-colors',
                'hover:border-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                isDragActive && 'border-primary bg-primary-soft',
                disabled && 'pointer-events-none opacity-50',
            )}
        >
            <input {...getInputProps()} id={id} />
            <HugeiconsIcon icon={CloudUploadIcon} size={22} className="text-fg-subtle" aria-hidden="true" />
            {file ? (
                <p className="text-sm font-medium text-fg break-all">
                    {file.name} <span className="font-normal text-fg-muted">· {fmtBytes(file.size)}</span>
                </p>
            ) : (
                <p className="text-sm text-fg-muted">
                    {isDragActive ? 'Déposez le fichier ici' : <>Glissez un fichier ici ou <span className="font-medium text-primary">choisissez-le</span></>}
                </p>
            )}
            <p className="text-xs text-fg-subtle">{hint}</p>
        </div>
    );
}
