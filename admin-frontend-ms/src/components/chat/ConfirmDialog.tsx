import { useState, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import { Button, Dialog, DialogClose, DialogContent } from '../ui';

export interface ConfirmRequest {
    title: string;
    message: ReactNode;
    /** Shown in a warning band (irreversible…). */
    warning?: ReactNode;
    confirmLabel?: string;
    /** Runs the action; the dialog stays open (button loading) until it settles. */
    onConfirm: () => Promise<void> | void;
}

/** Confirmation before a destructive action (deleting messages, conversations, stories). */
export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
    const [busy, setBusy] = useState(false);
    const confirm = async () => {
        if (!request) return;
        setBusy(true);
        try {
            await request.onConfirm();
        } finally {
            setBusy(false);
            onClose();
        }
    };
    return (
        <Dialog open={!!request} onOpenChange={open => { if (!open && !busy) onClose(); }}>
            {request && (
                <DialogContent
                    size="sm"
                    title={request.title}
                    description={request.message}
                    footer={(
                        <>
                            <DialogClose asChild>
                                <Button variant="outline" size="lg" disabled={busy}>Annuler</Button>
                            </DialogClose>
                            <Button variant="danger" size="lg" loading={busy} onClick={() => void confirm()}>
                                {request.confirmLabel ?? 'Supprimer'}
                            </Button>
                        </>
                    )}
                >
                    {request.warning && (
                        <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-sm text-fg">
                            <HugeiconsIcon icon={Alert02Icon} size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
                            {request.warning}
                        </p>
                    )}
                </DialogContent>
            )}
        </Dialog>
    );
}
