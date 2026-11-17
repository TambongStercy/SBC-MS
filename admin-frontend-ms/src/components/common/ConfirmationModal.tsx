import React, { useState } from 'react';
import { Button, Dialog, DialogContent } from '../ui';

interface ConfirmationModalProps {
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    isLoading?: boolean;
    /** red for destructive (default), green to approve, blue otherwise */
    variant?: 'danger' | 'success' | 'primary';
    onConfirm: () => void | Promise<unknown>;
    onCancel: () => void;
    children?: React.ReactNode;
}

const SUCCESS = 'bg-success text-white hover:bg-success/90 dark:text-background';

/**
 * Asks before an action (kit Dialog). When onConfirm returns a promise, both
 * buttons stay locked until it settles, so a double tap can never send a
 * payout twice. Escape / outside click cancel, except while busy.
 */
const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    title,
    message,
    confirmText = 'Confirmer',
    cancelText = 'Annuler',
    isLoading = false,
    variant = 'danger',
    onConfirm,
    onCancel,
    children,
}) => {
    const [running, setRunning] = useState(false);
    const busy = isLoading || running;

    const confirm = async () => {
        if (busy) return;
        const result = onConfirm();
        if (result && typeof (result as Promise<unknown>).then === 'function') {
            setRunning(true);
            try { await result; } finally { setRunning(false); }
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={open => { if (!open && !busy) onCancel(); }}>
            {isOpen && (
                <DialogContent
                    size="sm"
                    title={title}
                    footer={(
                        <>
                            <Button variant="outline" size="lg" onClick={onCancel} disabled={busy}>{cancelText}</Button>
                            <Button
                                variant={variant === 'danger' ? 'danger' : 'primary'}
                                className={variant === 'success' ? SUCCESS : undefined}
                                size="lg"
                                onClick={confirm}
                                loading={busy}
                            >
                                {busy ? 'Traitement…' : confirmText}
                            </Button>
                        </>
                    )}
                >
                    <div className="space-y-4 text-sm text-fg-muted">
                        <div>{message}</div>
                        {children}
                    </div>
                </DialogContent>
            )}
        </Dialog>
    );
};

export default ConfirmationModal;
