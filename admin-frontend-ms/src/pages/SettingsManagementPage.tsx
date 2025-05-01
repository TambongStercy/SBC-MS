import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom'; // Assuming react-router for links
import {
    Trash2, UploadCloud, Loader2, ExternalLink, Image as ImageIcon, Video as VideoIcon, File as FileIcon, Info, AlertTriangle
} from 'lucide-react'; // Keep lucide icons
import {
    getSettings, updateSettings, uploadCompanyLogo, uploadTermsPdf, uploadPresentationVideo,
    uploadPresentationPdf, getEvents, createEvent, deleteEvent, ISettings, IEvent,
    updateEvent // <--- Import updateEvent
} from '../services/adminSettingsApi'; // USE RELATIVE PATH for service
import apiClient from '../api/apiClient'; // <--- Import apiClient
import { useDropzone, FileRejection } from 'react-dropzone';
import toast from 'react-hot-toast'; // USE react-hot-toast

// Helper to get file type category
const getFileType = (mimeType?: string): 'image' | 'video' | 'pdf' | 'other' => {
    if (!mimeType) return 'other';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType === 'application/pdf') return 'pdf';
    return 'other';
};

// Helper component for file upload sections (using Tailwind)
interface FileUploadSectionProps {
    title: string;
    description?: string;
    fieldKey: keyof Pick<ISettings, 'companyLogo' | 'termsAndConditionsPdf' | 'presentationVideo' | 'presentationPdf'>;
    currentFile: ISettings[keyof Pick<ISettings, 'companyLogo' | 'termsAndConditionsPdf' | 'presentationVideo' | 'presentationPdf'>];
    uploadFunction: (file: File) => Promise<ISettings>;
    onUploadSuccess: (updatedSettings: ISettings) => void;
    accept: Record<string, string[]> // Example: { 'image/*': [], 'application/pdf': [] }
}

const FileUploadSection: React.FC<FileUploadSectionProps> = ({ title, description, fieldKey, currentFile, uploadFunction, onUploadSuccess, accept }) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null); // State for selected file preview URL
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    // Clean up object URLs
    useEffect(() => {
        // Revoke the object URL when the component unmounts or previewSrc changes
        return () => {
            if (previewSrc) {
                URL.revokeObjectURL(previewSrc);
            }
        };
    }, [previewSrc]);

    const onDrop = useCallback((acceptedFiles: File[], fileRejections: FileRejection[]) => {
        setUploadError(null);
        // Revoke previous preview if exists
        if (previewSrc) {
            URL.revokeObjectURL(previewSrc);
            setPreviewSrc(null);
        }

        if (acceptedFiles.length > 0) {
            const file = acceptedFiles[0];
            setSelectedFile(file);
            // Generate preview URL for image/video
            if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
                setPreviewSrc(URL.createObjectURL(file));
            } else {
                setPreviewSrc(null); // No preview for non-image/video types (yet)
            }
        } else {
            setSelectedFile(null); // Clear selection if only rejected files
        }

        if (fileRejections.length > 0) {
            // Keep existing selected file if there was one, otherwise clear
            // setSelectedFile(null); // Don't clear if there was already an accepted file
            const errorMsg = fileRejections[0].errors[0].message || 'Invalid file type or size.';
            setUploadError(errorMsg);
            toast.error(errorMsg); // Notify user
        }
    }, [previewSrc]); // Added previewSrc dependency

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept, maxFiles: 1 });

    const handleUpload = async () => {
        if (!selectedFile) return;
        setIsUploading(true);
        setUploadError(null);
        const toastId = toast.loading(`Uploading ${title}...`);
        try {
            const updatedSettings = await uploadFunction(selectedFile);
            onUploadSuccess(updatedSettings);
            setSelectedFile(null);
            if (previewSrc) {
                URL.revokeObjectURL(previewSrc); // Revoke after successful upload
                setPreviewSrc(null);
            }
            toast.success(`${title} updated successfully.`, { id: toastId });
        } catch (err: any) {
            console.error(`Error uploading ${title}:`, err);
            const errMsg = err.response?.data?.message || err.message || `Failed to upload ${title}.`;
            setUploadError(errMsg);
            toast.error(errMsg, { id: toastId });
        } finally {
            setIsUploading(false);
        }
    };

    // Determine current file type for preview
    const currentFileType = getFileType(currentFile?.mimeType);

    // Construct the ABSOLUTE proxy URL for the current file
    const getAbsoluteProxyUrl = (fileId?: string): string | null => {
        if (!fileId) return null;
        const baseUrl = apiClient.defaults.baseURL || '';
        const path = `/settings/files/${fileId}`; // Use path relative to API base
        return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    };
    const currentFileProxyUrl = getAbsoluteProxyUrl(currentFile?.fileId);

    // Logging for debugging
    if (title === 'Company Logo') {
        console.log(`[Logo Section] currentFile.fileId:`, currentFile?.fileId);
        console.log(`[Logo Section] Constructed Absolute Proxy URL:`, currentFileProxyUrl);
        console.log(`[Logo Section] currentFile.mimeType:`, currentFile?.mimeType);
        console.log(`[Logo Section] Calculated file type:`, currentFileType);
        console.log(`[Logo Section] Condition check (currentFileProxyUrl):`, !!currentFileProxyUrl);
        console.log(`[Logo Section] Condition check (currentFileType === 'image'):`, currentFileType === 'image');
    }

    return (
        <div className="bg-gray-800 shadow rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold mb-1 text-white">{title}</h3>
            {description && <p className="text-sm text-gray-400 mb-4">{description}</p>}

            {/* Current File Preview - Use ABSOLUTE proxy URL */}
            <div className="mb-4">
                <p className="text-sm font-medium text-gray-300 mb-2">Current File:</p>
                {currentFileProxyUrl ? (
                    <div className="flex items-start space-x-4 p-3 bg-gray-700 rounded">
                        {currentFileType === 'image' && (
                            <img src={currentFileProxyUrl} alt={`Current ${title}`} className="h-20 w-auto object-contain rounded" />
                        )}
                        {currentFileType === 'video' && (
                            <video src={currentFileProxyUrl} controls className="h-24 w-auto rounded" />
                        )}
                        {(currentFileType === 'pdf' || currentFileType === 'other') && (
                            <FileIcon className="h-10 w-10 text-gray-400 flex-shrink-0 mt-1" />
                        )}
                        <div className="flex-grow text-sm">
                            <a href={currentFileProxyUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-400 hover:text-indigo-300 break-all" title={currentFile?.fileName || 'View File'}>
                                {currentFile?.fileName || 'View File'}
                                <ExternalLink className="inline h-3 w-3 ml-1" />
                            </a>
                            {currentFile?.size && <p className="text-gray-400 mt-1">Size: {(currentFile.size / (1024 * 1024)).toFixed(2)} MB</p>}
                            {currentFile?.mimeType && <p className="text-gray-400">Type: {currentFile.mimeType}</p>}
                        </div>
                </div>
                ) : (
                    <p className="text-sm text-gray-400 italic">No file uploaded yet.</p>
            )}
            </div>

            {/* Dropzone */}
            <div
                {...getRootProps()}
                className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-md cursor-pointer transition-colors duration-200 ease-in-out ${isDragActive ? 'border-indigo-500 bg-gray-700' : 'border-gray-600 hover:border-gray-500'} mb-4`}
            >
                <input {...getInputProps()} />
                <UploadCloud className="h-8 w-8 text-gray-500 mb-2" />
                {selectedFile ? (
                    <p className="text-sm text-white font-semibold">Selected: {selectedFile.name}</p>
                ) : isDragActive ? (
                    <p className="text-sm text-gray-400">Drop the file here...</p>
                ) : (
                    <p className="text-sm text-gray-400">Drag 'n' drop {title.toLowerCase()} here, or click to select</p>
                )}
            </div>

            {/* Selected File Preview */}
            {selectedFile && (
                <div className="mb-4">
                    <p className="text-sm font-medium text-gray-300 mb-2">Preview:</p>
                    <div className="flex items-start space-x-4 p-3 bg-gray-700 rounded">
                        {previewSrc && selectedFile.type.startsWith('image/') && (
                            <img src={previewSrc} alt="Selected preview" className="h-20 w-auto object-contain rounded" />
                        )}
                        {previewSrc && selectedFile.type.startsWith('video/') && (
                            <video src={previewSrc} controls className="h-24 w-auto rounded" />
                        )}
                        {selectedFile.type === 'application/pdf' && (
                            <FileIcon className="h-10 w-10 text-gray-400 flex-shrink-0 mt-1" />
                        )}
                        <div className="flex-grow text-sm">
                            <p className="font-medium text-white break-all">{selectedFile.name}</p>
                            <p className="text-gray-400 mt-1">Size: {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                            <p className="text-gray-400">Type: {selectedFile.type}</p>
                        </div>
                    </div>
                </div>
            )}

            {uploadError && (
                <div className="mt-4 p-3 bg-red-900 border border-red-700 rounded-md text-red-100 text-sm flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-2 flex-shrink-0" />
                    <span>{uploadError}</span>
                </div>
            )}

            <div className="mt-4">
                <button
                    onClick={handleUpload}
                    disabled={!selectedFile || isUploading}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isUploading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <UploadCloud className="mr-2 h-4 w-4" />
                    )}
                    {/* Button text logic based on whether a file is currently uploaded */}
                    {currentFile?.url ? `Replace ${title}` : `Upload ${title}`}
                </button>
            </div>
        </div>
    );
};

// Main Page Component
const SettingsManagementPage: React.FC = () => {
    const [tabValue, setTabValue] = useState('general'); // Use string identifiers for tabs
    const [settings, setSettings] = useState<ISettings | null>(null);
    const [events, setEvents] = useState<IEvent[]>([]);
    const [eventPage, setEventPage] = useState(1);
    const [eventTotalPages, setEventTotalPages] = useState(1);
    const [eventLimit] = useState(5);
    const [isLoadingSettings, setIsLoadingSettings] = useState(true);
    const [isLoadingEvents, setIsLoadingEvents] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // State for General Settings form
    const [groupUrls, setGroupUrls] = useState({ whatsapp: '', telegram: '', discord: '' });

    // State for Create Event form
    const [newEventTitle, setNewEventTitle] = useState('');
    const [newEventDesc, setNewEventDesc] = useState('');
    const [newEventImage, setNewEventImage] = useState<File | null>(null);
    const [newEventVideo, setNewEventVideo] = useState<File | null>(null);
    const [newEventImagePreview, setNewEventImagePreview] = useState<string | null>(null);
    const [newEventVideoPreview, setNewEventVideoPreview] = useState<string | null>(null);
    const [isCreatingOrUpdatingEvent, setIsCreatingOrUpdatingEvent] = useState(false);
    const [createOrUpdateError, setCreateOrUpdateError] = useState<string | null>(null);

    // State for editing
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [editingEventId, setEditingEventId] = useState<string | null>(null);

    // State for Delete Confirmation Modal
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
    const [eventToDeleteId, setEventToDeleteId] = useState<string | null>(null);
    const [isDeletingEvent, setIsDeletingEvent] = useState<boolean>(false); // Loading state for delete

    // --- Helper to get absolute URL for event files --- 
    const getEventFileUrl = (fileId?: string): string | null => {
        if (!fileId) return null;
        const baseUrl = apiClient.defaults.baseURL || '';
        const path = `/settings/files/${fileId}`; // Path relative to API base
        return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    };

    // --- Fetching Data --- 
    const fetchSettings = useCallback(async () => {
        setIsLoadingSettings(true);
        setError(null);
        try {
            const fetchedSettings = await getSettings();
            setSettings(fetchedSettings);
            if (fetchedSettings) {
                setGroupUrls({
                    whatsapp: fetchedSettings.whatsappGroupUrl || '',
                    telegram: fetchedSettings.telegramGroupUrl || '',
                    discord: fetchedSettings.discordGroupUrl || '',
                });
            }
        } catch (err: any) {
            console.error('Failed to fetch settings:', err);
            const errMsg = err.response?.data?.message || err.message || 'Failed to load settings.';
            setError(errMsg);
            toast.error(errMsg);
        } finally {
            setIsLoadingSettings(false);
        }
    }, []);

    const fetchEvents = useCallback(async (page: number) => {
        setIsLoadingEvents(true);
        try {
            const response = await getEvents({ page: page, limit: eventLimit, sortOrder: 'desc' });
            setEvents(response.events || []);
            setEventTotalPages(response.totalPages || 1);
            setEventPage(response.currentPage || 1);
        } catch (err: any) {
            console.error('Failed to fetch events:', err);
            const errMsg = err.response?.data?.message || err.message || 'Failed to load events.';
            // Avoid duplicate errors if settings already failed
            if (!error) setError(errMsg);
            toast.error(errMsg);
        } finally {
            setIsLoadingEvents(false);
        }
    }, [eventLimit]);

    useEffect(() => {
        fetchSettings();
        fetchEvents(1);
    }, [fetchSettings, fetchEvents]);

    // --- Cleanup Object URLs --- 
    useEffect(() => {
        return () => {
            if (newEventImagePreview) URL.revokeObjectURL(newEventImagePreview);
            if (newEventVideoPreview) URL.revokeObjectURL(newEventVideoPreview);
        };
    }, [newEventImagePreview, newEventVideoPreview]);

    // --- Handlers --- 
    const handleTabChange = (value: string) => {
        setTabValue(value);
    };

    const handleGroupUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setGroupUrls({ ...groupUrls, [e.target.name]: e.target.value });
    };

    const handleSaveGroupUrls = async () => {
        setIsSaving(true);
        setError(null);
        const toastId = toast.loading('Saving links...');
        try {
            const updatedSettings = await updateSettings({
                whatsappGroupUrl: groupUrls.whatsapp.trim() || undefined,
                telegramGroupUrl: groupUrls.telegram.trim() || undefined,
                discordGroupUrl: groupUrls.discord.trim() || undefined,
            });
            setSettings(updatedSettings);
            toast.success('Group links updated successfully.', { id: toastId });
        } catch (err: any) {
            console.error('Failed to save group URLs:', err);
            const errMsg = err.response?.data?.message || err.message || 'Failed to save settings.';
            setError(errMsg);
            toast.error(errMsg, { id: toastId });
        } finally {
            setIsSaving(false);
        }
    };

    const handleFileUploadSuccess = (updatedSettings: ISettings) => {
        setSettings(updatedSettings);
    };

    // Function to reset the event form
    const resetEventForm = () => {
        setNewEventTitle('');
        setNewEventDesc('');
        setNewEventImage(null);
        setNewEventVideo(null);
        if (newEventImagePreview) URL.revokeObjectURL(newEventImagePreview);
        if (newEventVideoPreview) URL.revokeObjectURL(newEventVideoPreview);
        setNewEventImagePreview(null);
        setNewEventVideoPreview(null);
        setIsEditing(false);
        setEditingEventId(null);
        setCreateOrUpdateError(null);
    };

    // Modified handler for event form submission (Create or Update)
    const handleEventFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newEventTitle.trim() || !newEventDesc.trim() || (!newEventImage && !isEditing)) {
            setCreateOrUpdateError('Title, Description, and Image are required (Image required for new events).');
            toast.error('Event Title, Description, and Image are required (Image required for new events).');
            return;
        }

        setIsCreatingOrUpdatingEvent(true);
        setCreateOrUpdateError(null);
        const toastId = toast.loading(isEditing ? 'Updating event...' : 'Creating event...');

        const eventData = {
            title: newEventTitle.trim(),
            description: newEventDesc.trim(),
            // Only send files if they have been selected
            ...(newEventImage && { imageFile: newEventImage }),
            ...(newEventVideo && { videoFile: newEventVideo }),
            // TODO: Handle potential timestamp updates if needed
        };

        try {
            if (isEditing && editingEventId) {
                // Update existing event
                await updateEvent(editingEventId, eventData);
                toast.success('Event updated successfully.', { id: toastId });
            } else {
                // Create new event (ensure image is present)
                if (!newEventImage) throw new Error('Image file is required for new events.'); // Should be caught by initial check
                await createEvent({ ...eventData, imageFile: newEventImage });
            toast.success('Event created successfully.', { id: toastId });
            }
            resetEventForm();
            fetchEvents(1); // Refresh event list
        } catch (err: any) {
            console.error(isEditing ? 'Failed to update event:' : 'Failed to create event:', err);
            const errMsg = err.response?.data?.message || err.message || (isEditing ? 'Failed to update event.' : 'Failed to create event.');
            setCreateOrUpdateError(errMsg);
            toast.error(errMsg, { id: toastId });
        } finally {
            setIsCreatingOrUpdatingEvent(false);
        }
    };

    // Handler for clicking the Edit button on an event
    const handleEditClick = (event: IEvent) => {
        setIsEditing(true);
        setEditingEventId(event._id);
        setNewEventTitle(event.title);
        setNewEventDesc(event.description);
        setNewEventImage(null);
        setNewEventVideo(null);
        if (newEventImagePreview) URL.revokeObjectURL(newEventImagePreview);
        if (newEventVideoPreview) URL.revokeObjectURL(newEventVideoPreview);
        // Use absolute URLs for existing previews when editing
        setNewEventImagePreview(getEventFileUrl(event.image?.fileId));
        setNewEventVideoPreview(getEventFileUrl(event.video?.fileId));
        setCreateOrUpdateError(null);
        setTabValue('events');
    };

    // Handler for Cancel Edit button
    const handleCancelEdit = () => {
        resetEventForm();
    };

    // Renamed original delete handler to *initiate* the delete process
    const handleDeleteClick = (eventId: string) => {
        setEventToDeleteId(eventId);
        setIsDeleteModalOpen(true);
    };

    // Handler for closing the modal
    const closeDeleteModal = () => {
        setIsDeleteModalOpen(false);
        setEventToDeleteId(null);
    };

    // Handler for confirming the delete action in the modal
    const confirmDeleteHandler = async () => {
        if (!eventToDeleteId) return;

        setIsDeletingEvent(true);
        const toastId = toast.loading('Deleting event...');

        try {
            await deleteEvent(eventToDeleteId);
            toast.success('Event deleted successfully.', { id: toastId });
            setEvents(prev => prev.filter(event => event._id !== eventToDeleteId));
            // Adjust pagination if the last item on a page was deleted
            if (events.length === 1 && eventPage > 1) {
                fetchEvents(eventPage - 1);
            } else {
                // Refresh current page if needed, or rely on state update
                // fetchEvents(eventPage); // Optional: force refresh
            }
            closeDeleteModal(); // Close modal on success
        } catch (err: any) {
            console.error(`Failed to delete event ${eventToDeleteId}:`, err);
            const errMsg = err.response?.data?.message || err.message || 'Failed to delete event.';
            setError(errMsg); // Show error in main error display? Or just toast?
            toast.error(errMsg, { id: toastId });
            // Keep modal open on error?
            // closeDeleteModal(); 
        } finally {
            setIsDeletingEvent(false);
        }
    };

    // --- Dropzone Handlers for Event --- 
    const onEventImageDrop = useCallback((acceptedFiles: File[], fileRejections: FileRejection[]) => {
        setCreateOrUpdateError(null);
        if (newEventImagePreview && !acceptedFiles.length) {
            // If clearing selection during edit, keep old preview
        } else if (newEventImagePreview) {
            URL.revokeObjectURL(newEventImagePreview);
            setNewEventImagePreview(null);
        }

        if (acceptedFiles.length > 0) {
            const file = acceptedFiles[0];
            setNewEventImage(file); // Set the new file object for upload
            setNewEventImagePreview(URL.createObjectURL(file)); // Set new preview URL
        } else {
            // If no file accepted, reset image file state but keep potential existing preview if editing
            setNewEventImage(null);
            if (!isEditing) setNewEventImagePreview(null);
        }
        if (fileRejections.length > 0) toast.error(fileRejections[0].errors[0].message || 'Invalid image file.');
    }, [newEventImagePreview, isEditing]); // Added isEditing dependency

    const onEventVideoDrop = useCallback((acceptedFiles: File[], fileRejections: FileRejection[]) => {
        setCreateOrUpdateError(null);
        if (newEventVideoPreview && !acceptedFiles.length) {
            // If clearing selection during edit, keep old preview
        } else if (newEventVideoPreview) {
            URL.revokeObjectURL(newEventVideoPreview);
            setNewEventVideoPreview(null);
        }

        if (acceptedFiles.length > 0) {
            const file = acceptedFiles[0];
            setNewEventVideo(file);
            setNewEventVideoPreview(URL.createObjectURL(file));
        } else {
            setNewEventVideo(null);
            if (!isEditing) setNewEventVideoPreview(null);
        }
        if (fileRejections.length > 0) toast.error(fileRejections[0].errors[0].message || 'Invalid video file.');
    }, [newEventVideoPreview, isEditing]); // Added isEditing dependency

    const { getRootProps: getImageRootProps, getInputProps: getImageInputProps, isDragActive: isImageDragActive } = useDropzone({ onDrop: onEventImageDrop, accept: { 'image/*': [] }, maxFiles: 1 });
    const { getRootProps: getVideoRootProps, getInputProps: getVideoInputProps, isDragActive: isVideoDragActive } = useDropzone({ onDrop: onEventVideoDrop, accept: { 'video/*': [] }, maxFiles: 1 });

    // --- Pagination Handlers --- 
    const handleEventPageChange = (newPage: number) => {
        if (newPage > 0 && newPage <= eventTotalPages) {
            fetchEvents(newPage);
        }
    };

    // --- Render Logic --- 
    if (isLoadingSettings) {
        return (
            <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white flex justify-center items-center min-h-screen">
                <Loader2 className="h-16 w-16 animate-spin text-indigo-400" />
            </div>
        );
    }

    if (error && !settings) {
        return (
            <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white p-8">
                <div className="max-w-lg mx-auto p-4 bg-red-900 border border-red-700 rounded-md text-red-100">
                    <h2 className="text-lg font-semibold mb-2">Error Loading Settings</h2>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    // Tab Button Styling
    const getTabClassName = (value: string) => {
        return `px-4 py-2 text-sm font-medium rounded-md transition-colors duration-150 ease-in-out ${tabValue === value
            ? 'bg-indigo-600 text-white'
            : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }`;
    };

    return (
        <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white p-4 md:p-8">
            {/* <Header title="Application Settings" /> // Assuming Header component exists */}
            <h1 className="text-2xl md:text-3xl font-bold mb-6 text-white">Application Settings</h1>

            {/* Main error display if subsequent load fails */}
            {error && (
                <div className="mb-4 p-3 bg-red-900 border border-red-700 rounded-md text-red-100 text-sm">
                    {error}
                </div>
            )}

            {/* Tabs Implementation */}
            <div className="mb-6 border-b border-gray-700">
                <nav className="flex space-x-1" aria-label="Tabs">
                    <button onClick={() => handleTabChange('general')} className={getTabClassName('general')}>General</button>
                    <button onClick={() => handleTabChange('files')} className={getTabClassName('files')}>Files</button>
                    <button onClick={() => handleTabChange('events')} className={getTabClassName('events')}>Events</button>
                </nav>
            </div>

            {/* Tab Content */}
            <div>
                {/* General Settings Tab */}
                <div hidden={tabValue !== 'general'}>
                    <div className="bg-gray-800 shadow rounded-lg p-6">
                        <h3 className="text-lg font-semibold mb-4 text-white">Group Links</h3>
                        <p className="text-sm text-gray-400 mb-4">Set the public URLs for your community groups.</p>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="whatsapp" className="block text-sm font-medium text-gray-300 mb-1">WhatsApp Group URL</label>
                                <input
                                    type="url"
                                    id="whatsapp"
                                    name="whatsapp"
                                    placeholder="https://chat.whatsapp.com/..."
                                    value={groupUrls.whatsapp}
                                    onChange={handleGroupUrlChange}
                                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                                />
                            </div>
                            <div>
                                <label htmlFor="telegram" className="block text-sm font-medium text-gray-300 mb-1">Telegram Group URL</label>
                                <input
                                    type="url"
                                    id="telegram"
                                    name="telegram"
                                    placeholder="https://t.me/..."
                                    value={groupUrls.telegram}
                                    onChange={handleGroupUrlChange}
                                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                                />
                            </div>
                            <div>
                                <label htmlFor="discord" className="block text-sm font-medium text-gray-300 mb-1">Discord Invite URL</label>
                                <input
                                    type="url"
                                    id="discord"
                                    name="discord"
                                    placeholder="https://discord.gg/..."
                                    value={groupUrls.discord}
                                    onChange={handleGroupUrlChange}
                                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                                />
                            </div>
                        </div>
                        <div className="mt-6">
                            <button
                                onClick={handleSaveGroupUrls}
                                disabled={isSaving}
                                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500 disabled:opacity-50"
                            >
                                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Save Links
                            </button>
                        </div>
                    </div>
                </div>

                {/* Files Tab */}
                <div hidden={tabValue !== 'files'}>
                    <FileUploadSection
                        title="Company Logo"
                        description="Upload the main logo for the application (PNG, JPG, GIF, WEBP)."
                        fieldKey="companyLogo"
                        currentFile={settings?.companyLogo}
                        uploadFunction={uploadCompanyLogo}
                        onUploadSuccess={handleFileUploadSuccess}
                        accept={{ 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] }}
                    />
                    <FileUploadSection
                        title="Terms & Conditions PDF"
                        description="Upload the official terms and conditions document."
                        fieldKey="termsAndConditionsPdf"
                        currentFile={settings?.termsAndConditionsPdf}
                        uploadFunction={uploadTermsPdf}
                        onUploadSuccess={handleFileUploadSuccess}
                        accept={{ 'application/pdf': ['.pdf'] }}
                    />
                    <FileUploadSection
                        title="Presentation PDF"
                        description="Upload a PDF presentation about the platform or company."
                        fieldKey="presentationPdf"
                        currentFile={settings?.presentationPdf}
                        uploadFunction={uploadPresentationPdf}
                        onUploadSuccess={handleFileUploadSuccess}
                        accept={{ 'application/pdf': ['.pdf'] }}
                    />
                    <FileUploadSection
                        title="Presentation Video"
                        description="Upload a video presentation (e.g., MP4, WEBM). Consider size limits."
                        fieldKey="presentationVideo"
                        currentFile={settings?.presentationVideo}
                        uploadFunction={uploadPresentationVideo}
                        onUploadSuccess={handleFileUploadSuccess}
                        accept={{ 'video/*': ['.mp4', '.webm'] }}
                    />
                </div>

                {/* Events Tab */}
                <div hidden={tabValue !== 'events'}>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Event Form (Create/Update) */}
                        <div className="lg:col-span-1">
                            {/* Use handleEventFormSubmit for both create/update */}
                            <form onSubmit={handleEventFormSubmit} className="bg-gray-800 shadow rounded-lg p-6 space-y-4">
                                {/* Change title based on mode */}
                                <h3 className="text-lg font-semibold mb-4 text-white">
                                    {isEditing ? 'Update Event' : 'Create New Event'}
                                </h3>

                                {/* Event Title Input */}
                            <div>
                                    <label htmlFor="eventTitle" className="block text-sm font-medium text-gray-300 mb-1">Title</label>
                                <input
                                    type="text"
                                        id="eventTitle"
                                        className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white placeholder-gray-400"
                                        value={newEventTitle}
                                        onChange={(e) => setNewEventTitle(e.target.value)}
                                        required
                                    />
                                </div>

                                {/* Event Description Input */}
                                <div>
                                    <label htmlFor="eventDesc" className="block text-sm font-medium text-gray-300 mb-1">Description</label>
                                    <textarea
                                    id="eventDesc"
                                        rows={3}
                                        className="block w-full bg-gray-700 border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white placeholder-gray-400"
                                    value={newEventDesc}
                                        onChange={(e) => setNewEventDesc(e.target.value)}
                                    required
                                />
                            </div>

                                {/* Event Image Upload */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Event Image (Required)</label>
                                    <div
                                        {...getImageRootProps()}
                                        className={`flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-md cursor-pointer transition-colors ${isImageDragActive ? 'border-indigo-500 bg-gray-700' : 'border-gray-600 hover:border-gray-500'}`}
                                    >
                                        <input {...getImageInputProps()} />
                                        <UploadCloud className="h-6 w-6 text-gray-500 mb-1" />
                                        {newEventImage ? (
                                            <p className="text-sm text-white font-semibold">{newEventImage.name}</p>
                                        ) : (
                                            <p className="text-sm text-gray-400 text-center">Drag 'n' drop image, or click</p>
                                        )}
                                    </div>
                                    {/* Image Preview - Shows existing when editing, new when selected */}
                                    {newEventImagePreview && (
                                        <div className="mt-2">
                                            <p className="text-xs text-gray-400 mb-1">{isEditing && !newEventImage ? 'Current Image Preview:' : 'New Image Preview:'}</p>
                                            <img src={newEventImagePreview} alt="Event image preview" className="max-h-32 w-auto rounded border border-gray-600" />
                                        </div>
                                    )}
                                </div>

                                {/* Event Video Upload (Optional) */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Event Video (Optional)</label>
                                    <div
                                        {...getVideoRootProps()}
                                        className={`flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-md cursor-pointer transition-colors ${isVideoDragActive ? 'border-indigo-500 bg-gray-700' : 'border-gray-600 hover:border-gray-500'}`}
                                    >
                                        <input {...getVideoInputProps()} />
                                        <UploadCloud className="h-6 w-6 text-gray-500 mb-1" />
                                        {newEventVideo ? (
                                            <p className="text-sm text-white font-semibold">{newEventVideo.name}</p>
                                        ) : (
                                            <p className="text-sm text-gray-400 text-center">Drag 'n' drop video, or click</p>
                                        )}
                                    </div>
                                    {/* Video Preview - Shows existing when editing, new when selected */}
                                    {newEventVideoPreview && (
                                        <div className="mt-2">
                                            <p className="text-xs text-gray-400 mb-1">{isEditing && !newEventVideo ? 'Current Video Preview:' : 'New Video Preview:'}</p>
                                            <video src={newEventVideoPreview} controls className="max-h-32 w-auto rounded border border-gray-600" />
                                        </div>
                                    )}
                                </div>

                                {/* Error Display */}
                                {createOrUpdateError && (
                                    <div className="p-3 bg-red-900 border border-red-700 rounded-md text-red-100 text-sm">
                                        {createOrUpdateError}
                                </div>
                            )}

                                {/* Submit Button */}
                                <button
                                    type="submit"
                                    disabled={isCreatingOrUpdatingEvent}
                                    className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-green-500 disabled:opacity-50"
                                >
                                    {isCreatingOrUpdatingEvent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : (isEditing ? <UploadCloud className="mr-2 h-4 w-4" /> : <UploadCloud className="mr-2 h-4 w-4" />)}
                                    {isEditing ? 'Update Event' : 'Create Event'}
                                </button>
                                {/* Cancel Edit Button */}
                                {isEditing && (
                                    <button
                                        type="button" // Important: type=button to prevent form submission
                                        onClick={handleCancelEdit}
                                        className="w-full mt-2 inline-flex justify-center items-center px-4 py-2 border border-gray-600 text-sm font-medium rounded-md shadow-sm text-gray-300 bg-gray-700 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500"
                                    >
                                        Cancel Edit
                                    </button>
                                )}
                        </form>
                    </div>

                        {/* Event List */}
                        <div className="lg:col-span-2">
                    <div className="bg-gray-800 shadow rounded-lg p-6">
                        <h3 className="text-lg font-semibold mb-4 text-white">Existing Events</h3>
                                {isLoadingEvents ? (
                                    <div className="flex justify-center items-center p-8">
                                        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                                    </div>
                                ) : events.length === 0 ? (
                                    <p className="text-gray-400 italic">No events found.</p>
                                ) : (
                            <div className="space-y-4">
                                        {events.map((event) => {
                                            // Construct absolute URLs for this event's files
                                            const imageUrl = getEventFileUrl(event.image?.fileId);
                                            const videoUrl = getEventFileUrl(event.video?.fileId);
                                            return (
                                                <div key={event._id} className="flex items-start space-x-4 p-4 bg-gray-700 rounded-md">
                                                    {/* Event Previews Container */}
                                                    <div className="flex space-x-2 flex-shrink-0">
                                                        {/* Event Image Preview - Use absolute URL */}
                                                        {imageUrl && (
                                                            <img
                                                                src={imageUrl}
                                                                alt={`Event ${event._id} image`}
                                                                className="h-16 w-16 object-cover rounded bg-gray-600"
                                                                onError={(e) => { /* fallback */ }}
                                                            />
                                                        )}
                                                        {/* Optional Event Video Preview - Use absolute URL */}
                                                        {videoUrl && (
                                                            <video
                                                                src={videoUrl}
                                                                className="h-16 w-auto rounded bg-gray-600"
                                                                preload="metadata"
                                                            />
                                                )}
                                            </div>

                                                    <div className="flex-grow">
                                                        {/* Display Event Title */}
                                                        <p className="text-md font-semibold text-white mb-1 line-clamp-2">{event.title}</p>
                                                        <p className="text-sm text-gray-300 mb-1 line-clamp-3">{event.description}</p>
                                                        <p className="text-xs text-gray-400">
                                                            Posted: {new Date(event.timestamp || event.createdAt).toLocaleString()}
                                                        </p>
                                        </div>
                                                    <div className="flex flex-col space-y-1 flex-shrink-0">
                                                        {/* Edit Button */}
                                                        <button
                                                            onClick={() => handleEditClick(event)}
                                                            className="p-1 text-blue-400 hover:text-blue-300 focus:outline-none"
                                                            title="Edit Event"
                                                        >
                                                            {/* Use an appropriate edit icon if available */}
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                        </button>
                                                        {/* Delete Button - Now triggers modal */}
                                        <button
                                                            onClick={() => handleDeleteClick(event._id)} // Use new handler
                                                            className="p-1 text-red-400 hover:text-red-300 focus:outline-none"
                                            title="Delete Event"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                                </div>
                                            );
                                        })}
                            </div>
                        )}
                                {/* Pagination Controls */}
                        {eventTotalPages > 1 && (
                                    <div className="mt-6 flex justify-between items-center text-sm">
                                    <button
                                        onClick={() => handleEventPageChange(eventPage - 1)}
                                            disabled={eventPage <= 1 || isLoadingEvents}
                                            className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Previous
                                    </button>
                                        <span className="text-gray-400">Page {eventPage} of {eventTotalPages}</span>
                                    <button
                                        onClick={() => handleEventPageChange(eventPage + 1)}
                                            disabled={eventPage >= eventTotalPages || isLoadingEvents}
                                            className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Next
                                    </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {isDeleteModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 transition-opacity duration-300 ease-in-out" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                    <div className="relative bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:max-w-lg sm:w-full">
                        <div className="bg-gray-800 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                            <div className="sm:flex sm:items-start">
                                <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-900 sm:mx-0 sm:h-10 sm:w-10">
                                    <AlertTriangle className="h-6 w-6 text-red-400" aria-hidden="true" />
                                </div>
                                <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                                    <h3 className="text-lg leading-6 font-medium text-white" id="modal-title">
                                        Delete Event
                                    </h3>
                                    <div className="mt-2">
                                        <p className="text-sm text-gray-400">
                                            Are you sure you want to delete this event? This action cannot be undone.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-gray-700 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                            <button
                                type="button"
                                disabled={isDeletingEvent}
                                className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                                onClick={confirmDeleteHandler}
                            >
                                {isDeletingEvent ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : null}
                                Delete
                            </button>
                            <button
                                type="button"
                                className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-600 shadow-sm px-4 py-2 bg-gray-800 text-base font-medium text-gray-300 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                onClick={closeDeleteModal}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default SettingsManagementPage; 