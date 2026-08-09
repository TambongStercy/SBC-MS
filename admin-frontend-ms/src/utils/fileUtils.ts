/**
 * File utilities for handling both Google Drive (legacy) and Cloud Storage (new) files
 * Based on the cloud storage migration guide
 */

// Cloud Storage bucket URL
const CLOUD_STORAGE_BASE_URL = 'https://storage.googleapis.com/sbc-file-storage';

/**
 * Generate the appropriate file URL based on file ID format
 * @param fileId - File identifier (Google Drive ID or Cloud Storage path)
 * @param baseUrl - Base URL for proxy requests (for Google Drive files)
 * @returns Complete URL for file access
 */
export const getFileUrl = (fileId: string, baseUrl: string = '/api/settings/files'): string => {
  if (!fileId) return '';
  
  // Handle full URLs (already processed)
  if (fileId.startsWith('http')) {
    return fileId;
  }
  
  // Cloud Storage files - return direct CDN URL (saves bandwidth!)
  //
  // Detected by "not a Google Drive id" rather than by folder prefix. Uploads
  // through /settings/files/upload land at the bucket root with a plain
  // filename ("1786260910104_flyer.jpeg") — no slash, no known prefix — so a
  // prefix-only test sent them down the Drive path and produced a broken image.
  // On the admin host that fails silently in the worst way: nothing proxies
  // /api there, so the URL resolves to the SPA's own index.html and the browser
  // gets 200 text/html where it expected an image.
  //
  // Drive ids are opaque and extensionless; anything carrying a file extension
  // or a path separator is Cloud Storage.
  const looksLikeDriveId = !fileId.includes('/') && !/\.[a-z0-9]{2,5}$/i.test(fileId);
  if (!looksLikeDriveId) {
    return `${CLOUD_STORAGE_BASE_URL}/${fileId}`;
  }

  // Google Drive files - use proxy (legacy only)
  return `${baseUrl}/${fileId}`;
};

/**
 * Check if a file ID represents a Cloud Storage file
 * @param fileId - File identifier
 * @returns true if it's a Cloud Storage file
 */
export const isCloudStorageFile = (fileId: string): boolean => {
  return fileId.includes('/') || 
         fileId.startsWith('avatars/') || 
         fileId.startsWith('products/') || 
         fileId.startsWith('documents/');
};

/**
 * Check if a file ID represents a Google Drive file
 * @param fileId - File identifier
 * @returns true if it's a Google Drive file
 */
export const isGoogleDriveFile = (fileId: string): boolean => {
  return fileId.length === 33 && fileId.startsWith('1');
};

/**
 * Detect storage type for analytics/debugging
 * @param fileId - File identifier
 * @returns Storage type
 */
export const getStorageType = (fileId: string): 'gcs' | 'drive' | 'url' => {
  if (fileId.startsWith('http')) return 'url';
  if (isCloudStorageFile(fileId)) return 'gcs';
  if (isGoogleDriveFile(fileId)) return 'drive';
  return 'gcs'; // Default for new files
};

/**
 * Get avatar URL with proper handling for both storage types
 * @param avatarId - Avatar file identifier
 * @param baseUrl - Base URL for proxy requests
 * @returns Complete URL for avatar access
 */
export const getAvatarUrl = (avatarId?: string | null, baseUrl: string = '/api/users/files'): string => {
  if (!avatarId) return '';
  return getFileUrl(avatarId, baseUrl);
};

/**
 * Generate absolute proxy URL for legacy Google Drive files
 * @param fileId - File identifier
 * @param apiBaseUrl - API base URL
 * @param endpoint - Specific endpoint path
 * @returns Absolute proxy URL
 */
export const getAbsoluteProxyUrl = (
  fileId?: string, 
  apiBaseUrl: string = '', 
  endpoint: string = '/settings/files'
): string | null => {
  if (!fileId) return null;
  
  // For Cloud Storage files, return direct CDN URL
  if (isCloudStorageFile(fileId)) {
    return `${CLOUD_STORAGE_BASE_URL}/${fileId}`;
  }
  
  // For Google Drive files, return proxy URL
  const baseUrl = apiBaseUrl || '';
  const path = `${endpoint}/${fileId}`;
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}; 