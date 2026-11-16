import React from 'react';
import { X } from 'lucide-react';
import { ChallengeStatus, STATUS_LABELS } from '../../services/impactChallengeApi';

/** Badge colours readable in both themes (the service's STATUS_STYLES are dark-only). */
const BADGE_STYLES: Record<ChallengeStatus, string> = {
    draft: 'bg-surface-2 text-fg-muted',
    active: 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-300',
    voting_closed: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/60 dark:text-yellow-300',
    funds_distributed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300',
};

export const StatusBadge: React.FC<{ status: ChallengeStatus }> = ({ status }) => (
    <span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full whitespace-nowrap ${BADGE_STYLES[status] ?? 'bg-surface-2 text-fg'}`}>
        {STATUS_LABELS[status] ?? status}
    </span>
);

export const Notice: React.FC<{ tone: 'warning' | 'danger' | 'info' | 'success'; children: React.ReactNode; className?: string }> = ({ tone, children, className = '' }) => {
    const tones = {
        warning: 'text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700',
        danger: 'text-red-800 dark:text-red-200 bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700',
        info: 'text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700',
        success: 'text-green-800 dark:text-green-200 bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700',
    };
    return <div className={`border rounded-lg p-3 text-sm ${tones[tone]} ${className}`}>{children}</div>;
};

/** A form in a modal; closing is blocked while it is saving or uploading. */
export const FormModal: React.FC<{
    title: string;
    onClose: () => void;
    busy?: boolean;
    footer: React.ReactNode;
    children: React.ReactNode;
    wide?: boolean;
}> = ({ title, onClose, busy = false, footer, children, wide = false }) => (
    <div className="fixed inset-0 bg-black/75 flex justify-center items-start sm:items-center z-50 p-4 overflow-y-auto">
        <div className={`bg-surface rounded-lg w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} my-auto border border-line`}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-line">
                <h2 className="text-xl font-semibold text-fg">{title}</h2>
                <button onClick={onClose} disabled={busy} className="text-fg-muted hover:text-fg disabled:opacity-40" aria-label="Fermer">
                    <X className="w-5 h-5" />
                </button>
            </div>
            <div className="px-6 py-4 space-y-4">{children}</div>
            <div className="px-6 pb-5 pt-2 flex justify-end gap-3">{footer}</div>
        </div>
    </div>
);
