import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
// Removed import for base Modal

interface MetadataViewerModalProps {
    isOpen: boolean;
    onClose: () => void;
    metadata: Record<string, any> | null;
}

const MetadataViewerModal: React.FC<MetadataViewerModalProps> = ({
    isOpen,
    onClose,
    metadata
}) => {
    if (!isOpen) return null;

    const formattedJson = metadata
        ? JSON.stringify(metadata, null, 2) // Pretty print JSON
        : 'Aucune métadonnée.';

    // Use structure similar to ConfirmationModal
    return (
        <div className="fixed inset-0 bg-black/75 flex justify-center items-center z-50 p-4" onClick={onClose}> {/* Added onClick to overlay for closing */}
            {/* Stop propagation to prevent closing when clicking inside the modal content */}
            <div className="bg-surface p-6 rounded-lg w-full max-w-2xl border border-line" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-fg">Métadonnées de la transaction</h2>
                    <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Fermer"><HugeiconsIcon icon={Cancel01Icon} size={20} /></button>
                </div>
                <div className="max-h-96 overflow-y-auto bg-surface-2 p-4 rounded-sm text-sm">
                    <pre className="whitespace-pre-wrap wrap-break-word text-fg">
                        {formattedJson}
                    </pre>
                </div>
                <div className="mt-6 flex justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-surface-3 text-fg rounded-md hover:bg-surface-2 focus:outline-hidden focus:ring-2 focus:ring-fg-subtle focus:ring-offset-2 focus:ring-offset-surface"
                    >
                        Fermer
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MetadataViewerModal; 