import { useState } from 'react';
import {
    EXPORT_FORMATS, EXPORT_KIND_LABELS, downloadAnimationExport, type ExportFormat, type ExportKind, type ExportScope,
} from '../../../api/animation';
import { Button, notify } from '../../../ui';

const FORMAT_LABELS: Record<ExportFormat, string> = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' };

/**
 * One line per export, one button per format. Downloads through apiClient
 * (admin token); the server's own message is shown when it refuses.
 */
export function ExportButtons({ kinds, scope, formats = EXPORT_FORMATS }: {
    kinds: ExportKind[]; scope: ExportScope; formats?: ExportFormat[];
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const run = async (kind: ExportKind, format: ExportFormat) => {
        setBusy(`${kind}.${format}`);
        try {
            await downloadAnimationExport(kind, format, scope);
            notify.success(`Export ${EXPORT_KIND_LABELS[kind]} (${FORMAT_LABELS[format]}) téléchargé.`);
        } catch (e) {
            notify.error(e instanceof Error ? e.message : 'Export impossible.');
        } finally { setBusy(null); }
    };
    return (
        <ul className="divide-y divide-border">
            {kinds.map(kind => (
                <li key={kind} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm font-semibold text-ink">{EXPORT_KIND_LABELS[kind]}</span>
                    <span className="flex gap-1.5">
                        {formats.map(format => (
                            <Button key={format} size="sm" variant="secondary" disabled={busy !== null && busy !== `${kind}.${format}`}
                                loading={busy === `${kind}.${format}`} onClick={() => run(kind, format)}>
                                {FORMAT_LABELS[format]}
                            </Button>
                        ))}
                    </span>
                </li>
            ))}
        </ul>
    );
}
