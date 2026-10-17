import React from 'react';
import { X } from 'lucide-react';
import { ChallengeStatus, STATUS_LABELS, STATUS_STYLES } from '../../services/impactChallengeApi';

export const StatusBadge: React.FC<{ status: ChallengeStatus }> = ({ status }) => (
    <span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full whitespace-nowrap ${STATUS_STYLES[status] ?? 'bg-gray-700 text-gray-200'}`}>
        {STATUS_LABELS[status] ?? status}
    </span>
);

export const Notice: React.FC<{ tone: 'warning' | 'danger' | 'info' | 'success'; children: React.ReactNode; className?: string }> = ({ tone, children, className = '' }) => {
    const tones = {
        warning: 'text-amber-200 bg-amber-900/20 border-amber-700',
        danger: 'text-red-200 bg-red-900/30 border-red-700',
        info: 'text-blue-200 bg-blue-900/20 border-blue-700',
        success: 'text-green-200 bg-green-900/20 border-green-700',
    };
    return <div className={`border rounded-lg p-3 text-sm ${tones[tone]} ${className}`}>{children}</div>;
};

/** A form in a dark modal; closing is blocked while it is saving or uploading. */
export const FormModal: React.FC<{
    title: string;
    onClose: () => void;
    busy?: boolean;
    footer: React.ReactNode;
    children: React.ReactNode;
    wide?: boolean;
}> = ({ title, onClose, busy = false, footer, children, wide = false }) => (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-start sm:items-center z-50 p-4 overflow-y-auto">
        <div className={`bg-gray-800 rounded-lg shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} my-auto`}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-700">
                <h2 className="text-xl font-semibold text-white">{title}</h2>
                <button onClick={onClose} disabled={busy} className="text-gray-400 hover:text-white disabled:opacity-40" aria-label="Fermer">
                    <X className="w-5 h-5" />
                </button>
            </div>
            <div className="px-6 py-4 space-y-4">{children}</div>
            <div className="px-6 pb-5 pt-2 flex justify-end gap-3">{footer}</div>
        </div>
    </div>
);
