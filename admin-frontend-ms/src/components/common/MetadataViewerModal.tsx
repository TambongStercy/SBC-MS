import React from 'react';
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
        : 'No metadata available.';

    // Use structure similar to ConfirmationModal
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4" onClick={onClose}> {/* Added onClick to overlay for closing */}
            {/* Stop propagation to prevent closing when clicking inside the modal content */}
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white">Transaction Metadata</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-200">&times;</button> {/* Simple close button */}
                </div>
                <div className="max-h-96 overflow-y-auto bg-gray-700 p-4 rounded text-sm">
                    <pre className="whitespace-pre-wrap break-words text-gray-200">
                        {formattedJson}
                    </pre>
                </div>
                <div className="mt-6 flex justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MetadataViewerModal; 