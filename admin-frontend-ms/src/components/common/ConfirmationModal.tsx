import React, { useState } from 'react';

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

const CONFIRM_STYLES = {
    danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    success: 'bg-green-600 hover:bg-green-700 focus:ring-green-500',
    primary: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
};

/**
 * Asks before an action. When onConfirm returns a promise, both buttons stay
 * locked until it settles, so a double tap can never send a payout twice.
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
    if (!isOpen) {
        return null;
    }
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
        <div className="fixed inset-0 bg-black/75 flex justify-center items-center z-50 p-4">
            <div className="bg-surface p-6 rounded-lg w-full max-w-sm border border-line">
                <h2 className="text-xl font-semibold text-fg mb-4">{title}</h2>
                <div className="text-fg-muted mb-6">{message}</div>
                {children}
                <div className="flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        disabled={busy}
                        className="px-4 py-2 bg-surface-3 text-fg text-sm font-medium rounded-md hover:bg-surface-2 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-fg-subtle focus:ring-offset-surface disabled:opacity-50"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={confirm}
                        disabled={busy}
                        className={`px-4 py-2 text-white text-sm font-medium rounded-md focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface disabled:opacity-50 ${CONFIRM_STYLES[variant]}`}
                    >
                        {busy ? 'Traitement…' : confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;
