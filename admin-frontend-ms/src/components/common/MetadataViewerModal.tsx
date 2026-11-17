import React from 'react';
import { Button, Dialog, DialogClose, DialogContent } from '../ui';

interface MetadataViewerModalProps {
    isOpen: boolean;
    onClose: () => void;
    metadata: Record<string, unknown> | null;
    title?: string;
}

/** Raw metadata of a record, pretty-printed (kit Dialog). */
const MetadataViewerModal: React.FC<MetadataViewerModalProps> = ({ isOpen, onClose, metadata, title = 'Métadonnées de la transaction' }) => {
    const formattedJson = metadata ? JSON.stringify(metadata, null, 2) : 'Aucune métadonnée.';
    return (
        <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
            {isOpen && (
                <DialogContent
                    size="lg"
                    title={title}
                    footer={<DialogClose asChild><Button size="lg">Fermer</Button></DialogClose>}
                >
                    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface-2 p-4 font-mono text-xs text-fg">
                        {formattedJson}
                    </pre>
                </DialogContent>
            )}
        </Dialog>
    );
};

export default MetadataViewerModal;
