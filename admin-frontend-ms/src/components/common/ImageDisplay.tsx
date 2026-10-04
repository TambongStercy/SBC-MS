import React from 'react';
import { getFileUrl, getStorageType } from '../../utils/fileUtils';

interface ImageDisplayProps {
    fileId: string;
    alt: string;
    className?: string;
    onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
    fallbackSrc?: string;
    /** Show storage type for debugging */
    showDebugInfo?: boolean;
}

export const ImageDisplay: React.FC<ImageDisplayProps> = ({
    fileId,
    alt,
    className = '',
    onError,
    fallbackSrc,
    showDebugInfo = false
}) => {
    const imageUrl = getFileUrl(fileId);

    const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        console.error('Failed to load image:', fileId, 'URL:', imageUrl);

        if (onError) {
            onError(e);
        } else if (fallbackSrc) {
            // Set fallback source
            const target = e.target as HTMLImageElement;
            target.src = fallbackSrc;
        }
    };

    // Debug information
    if (showDebugInfo) {
        console.log('ImageDisplay Debug:', {
            fileId,
            storageType: getStorageType(fileId),
            finalUrl: imageUrl
        });
    }

    return (
        <img
            src={imageUrl}
            alt={alt}
            className={className}
            onError={handleError}
            title={showDebugInfo ? `Storage: ${getStorageType(fileId)} | URL: ${imageUrl}` : alt}
        />
    );
}; 