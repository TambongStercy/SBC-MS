import { ReactNode, useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';
import { Textarea } from './Field';
import { errorMessage } from '../lib/hooks';

/**
 * Asks before an action that matters. Names what will happen in the message;
 * green to approve, red to destroy. Locked while the action runs, so a double
 * tap can't pay twice; if it fails, the sheet stays open with the reason.
 */
export function ConfirmSheet({ open, title, message, confirmLabel, tone = 'primary', reason, onConfirm, onClose }: {
    open: boolean;
    title: ReactNode;
    message?: ReactNode;
    confirmLabel: string;
    tone?: 'primary' | 'success' | 'danger';
    /** Ask for a written reason (required, minimum length). */
    reason?: { label: string; placeholder?: string; minLength?: number; suggestions?: string[] };
    onConfirm: (reason: string) => Promise<unknown> | unknown;
    onClose: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { if (open) { setText(''); setError(null); } }, [open]);

    const min = reason?.minLength ?? (reason ? 3 : 0);
    const ready = !reason || text.trim().length >= min;

    const run = async () => {
        if (busy || !ready) return;
        setBusy(true);
        setError(null);
        try {
            await onConfirm(text.trim());
            onClose();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet open={open} onClose={onClose} busy={busy} title={title}
            footer={
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    <Button variant="secondary" onClick={onClose} disabled={busy}>Annuler</Button>
                    <Button variant={tone === 'primary' ? 'primary' : tone} onClick={run} loading={busy} disabled={!ready}>{confirmLabel}</Button>
                </div>
            }>
            {message && <div className="text-sm text-ink-2 space-y-2">{message}</div>}
            {reason && (
                <div className="mt-4">
                    {reason.suggestions && reason.suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                            {reason.suggestions.map(sg => (
                                <button key={sg} type="button" onClick={() => setText(sg)}
                                    className={`rounded-pill border px-3 py-1.5 text-sm ${text === sg ? 'border-primary bg-primary-soft text-primary' : 'border-border text-ink-2 hover:bg-surface-2'}`}>
                                    {sg}
                                </button>
                            ))}
                        </div>
                    )}
                    <Textarea label={reason.label} placeholder={reason.placeholder} value={text} onChange={e => setText(e.target.value)} rows={3} />
                </div>
            )}
            {error && <p className="mt-3 text-sm text-danger bg-danger-soft rounded-tile px-3 py-2" role="alert">{error}</p>}
        </Sheet>
    );
}
