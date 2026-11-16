import React, { useState, useEffect, useCallback } from 'react';
import {
    Trash2, UploadCloud, Loader2, ExternalLink, File as FileIcon, AlertTriangle
} from 'lucide-react'; // Keep lucide icons
import {
    getSettings, updateSettings, uploadCompanyLogo, uploadTermsPdf, uploadPresentationVideo,
    uploadPresentationPdf, getEvents, createEvent, deleteEvent, ISettings, IEvent,
    updateEvent, // <--- Import updateEvent
    IFormation, getFormations, addFormation, updateFormation, removeFormation // <--- NEW: Import formation APIs and interface
} from '../services/adminSettingsApi'; // USE RELATIVE PATH for service
import apiClient from '../api/apiClient'; // <--- Import apiClient
import { useDropzone, FileRejection } from 'react-dropzone';
import toast from 'react-hot-toast'; // USE react-hot-toast
import WinnerVipLinkCard from '../components/settings/WinnerVipLinkCard';
import { getFileUrl, getAbsoluteProxyUrl, getStorageType } from '../utils/fileUtils';
import { ImageDisplay } from '../components/common/ImageDisplay';

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

    console.log(fieldKey);
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
            const errorMsg = fileRejections[0].errors[0].message || 'Type ou taille de fichier non valide.';
            setUploadError(errorMsg);
            toast.error(errorMsg); // Notify user
        }
    }, [previewSrc]); // Added previewSrc dependency

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept, maxFiles: 1 });

    const handleUpload = async () => {
        if (!selectedFile) return;
        setIsUploading(true);
        setUploadError(null);
        const toastId = toast.loading(`Envoi en cours : ${title}…`);
        try {
            const updatedSettings = await uploadFunction(selectedFile);
            onUploadSuccess(updatedSettings);
            setSelectedFile(null);
            if (previewSrc) {
                URL.revokeObjectURL(previewSrc); // Revoke after successful upload
                setPreviewSrc(null);
            }
            toast.success(`${title} : mis à jour.`, { id: toastId });
        } catch (err: any) {
            console.error(`Error uploading ${title}:`, err);
            const errMsg = err.response?.data?.message || err.message || `Échec de l'envoi : ${title}.`;
            setUploadError(errMsg);
            toast.error(errMsg, { id: toastId });
        } finally {
            setIsUploading(false);
        }
    };

    // Determine current file type for preview
    const currentFileType = getFileType(currentFile?.mimeType);

    // Get the appropriate URL for the current file (Cloud Storage or proxy)
    const currentFileUrl = currentFile?.fileId ?
        getFileUrl(currentFile.fileId, `${apiClient.defaults.baseURL || ''}/settings/files`) :
        null;

    // Logging for debugging
    if (fieldKey === 'companyLogo') {
        console.log(`[Logo Section] currentFile.fileId:`, currentFile?.fileId);
        console.log(`[Logo Section] Storage Type:`, currentFile?.fileId ? getStorageType(currentFile.fileId) : 'none');
        console.log(`[Logo Section] Final URL:`, currentFileUrl);
        console.log(`[Logo Section] currentFile.mimeType:`, currentFile?.mimeType);
        console.log(`[Logo Section] Calculated file type:`, currentFileType);
        console.log(`[Logo Section] Condition check (currentFileUrl):`, !!currentFileUrl);
        console.log(`[Logo Section] Condition check (currentFileType === 'image'):`, currentFileType === 'image');
    }

    return (
        <div className="bg-surface border border-line rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold mb-1 text-fg">{title}</h3>
            {description && <p className="text-sm text-fg-muted mb-4">{description}</p>}

            {/* Current File Preview - Use new file URL system */}
            <div className="mb-4">
                <p className="text-sm font-medium text-fg-muted mb-2">Fichier actuel :</p>
                {currentFileUrl ? (
                    <div className="flex items-start space-x-4 p-3 bg-surface-2 rounded-sm">
                        {currentFileType === 'image' && currentFile?.fileId && (
                            <ImageDisplay
                                fileId={currentFile.fileId}
                                alt={`${title} actuel`}
                                className="h-20 w-auto object-contain rounded-sm"
                                showDebugInfo={fieldKey === 'companyLogo'}
                            />
                        )}
                        {currentFileType === 'video' && (
                            <video src={currentFileUrl} controls className="h-24 w-auto rounded-sm" />
                        )}
                        {(currentFileType === 'pdf' || currentFileType === 'other') && (
                            <FileIcon className="h-10 w-10 text-fg-muted shrink-0 mt-1" />
                        )}
                        <div className="grow text-sm">
                            <a href={currentFileUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 break-all" title={currentFile?.fileName || 'Voir le fichier'}>
                                {currentFile?.fileName || 'Voir le fichier'}
                                <ExternalLink className="inline h-3 w-3 ml-1" />
                            </a>
                            {currentFile?.size && <p className="text-fg-muted mt-1">Taille : {(currentFile.size / (1024 * 1024)).toFixed(2)} MB</p>}
                            {currentFile?.mimeType && <p className="text-fg-muted">Type : {currentFile.mimeType}</p>}
                            {currentFile?.fileId && fieldKey === 'companyLogo' && (
                                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Stockage : {getStorageType(currentFile.fileId)}</p>
                            )}
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-fg-muted italic">Aucun fichier envoyé pour le moment.</p>
                )}
            </div>

            {/* Dropzone */}
            <div
                {...getRootProps()}
                className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-md cursor-pointer transition-colors duration-200 ease-in-out ${isDragActive ? 'border-indigo-500 bg-surface-2' : 'border-line-strong hover:border-fg-subtle'} mb-4`}
            >
                <input {...getInputProps()} />
                <UploadCloud className="h-8 w-8 text-fg-subtle mb-2" />
                {selectedFile ? (
                    <p className="text-sm text-fg font-semibold">Sélectionné : {selectedFile.name}</p>
                ) : isDragActive ? (
                    <p className="text-sm text-fg-muted">Déposez le fichier ici…</p>
                ) : (
                    <p className="text-sm text-fg-muted">Glissez-déposez le fichier ici, ou cliquez pour le choisir</p>
                )}
            </div>

            {/* Selected File Preview */}
            {selectedFile && (
                <div className="mb-4">
                    <p className="text-sm font-medium text-fg-muted mb-2">Aperçu :</p>
                    <div className="flex items-start space-x-4 p-3 bg-surface-2 rounded-sm">
                        {previewSrc && selectedFile.type.startsWith('image/') && (
                            <img src={previewSrc} alt="Aperçu du fichier choisi" className="h-20 w-auto object-contain rounded-sm" />
                        )}
                        {previewSrc && selectedFile.type.startsWith('video/') && (
                            <video src={previewSrc} controls className="h-24 w-auto rounded-sm" />
                        )}
                        {selectedFile.type === 'application/pdf' && (
                            <FileIcon className="h-10 w-10 text-fg-muted shrink-0 mt-1" />
                        )}
                        <div className="grow text-sm">
                            <p className="font-medium text-fg break-all">{selectedFile.name}</p>
                            <p className="text-fg-muted mt-1">Taille : {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                            <p className="text-fg-muted">Type : {selectedFile.type}</p>
                        </div>
                    </div>
                </div>
            )}

            {uploadError && (
                <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-md text-red-800 dark:text-red-100 text-sm flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-2 shrink-0" />
                    <span>{uploadError}</span>
                </div>
            )}

            <div className="mt-4">
                <button
                    onClick={handleUpload}
                    disabled={!selectedFile || isUploading}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isUploading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <UploadCloud className="mr-2 h-4 w-4" />
                    )}
                    {/* Button text logic based on whether a file is currently uploaded */}
                    {currentFile?.url ? 'Remplacer le fichier' : 'Envoyer le fichier'}
                </button>
            </div>
        </div>
    );
};

const DECORATION_LABELS: Record<string, string> = { orange: 'Orange', gold: 'Doré', new: 'Nouveau' };

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

    // State for Delete Confirmation Modal (Events)
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
    const [eventToDeleteId, setEventToDeleteId] = useState<string | null>(null);
    const [isDeletingEvent, setIsDeletingEvent] = useState<boolean>(false); // Loading state for delete

    // NEW: State for Formations
    const [formations, setFormations] = useState<IFormation[]>([]);
    const [isLoadingFormations, setIsLoadingFormations] = useState(false);
    const [newFormationTitle, setNewFormationTitle] = useState('');
    const [newFormationLink, setNewFormationLink] = useState('');
    const [newFormationTier, setNewFormationTier] = useState<'' | 'CLASSIQUE' | 'CIBLE'>('');
    const [newFormationDecoration, setNewFormationDecoration] = useState<string>('');
    const [isCreatingOrUpdatingFormation, setIsCreatingOrUpdatingFormation] = useState(false);
    const [formationCreateOrUpdateError, setFormationCreateOrUpdateError] = useState<string | null>(null);
    const [isEditingFormation, setIsEditingFormation] = useState<boolean>(false);
    const [editingFormationId, setEditingFormationId] = useState<string | null>(null);
    const [isFormationDeleteModalOpen, setIsFormationDeleteModalOpen] = useState<boolean>(false);
    const [formationToDeleteId, setFormationToDeleteId] = useState<string | null>(null);
    const [isDeletingFormation, setIsDeletingFormation] = useState<boolean>(false);

    // --- Helper to get URL for event files using new system --- 
    const getEventFileUrl = (fileId?: string): string | null => {
        if (!fileId) return null;
        return getFileUrl(fileId, `${apiClient.defaults.baseURL || ''}/settings/files`);
    };

    // --- Fetching Data --- 
    const fetchSettings = useCallback(async () => {
        setIsLoadingSettings(true);
        setError(null);
        try {
            const fetchedSettings = await getSettings();
            setSettings(fetchedSettings);
        } catch (err: any) {
            console.error('Failed to fetch settings:', err);
            const errMsg = err.response?.data?.message || err.message || 'Impossible de charger les paramètres.';
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
            const errMsg = err.response?.data?.message || err.message || 'Impossible de charger les événements.';
            // Avoid duplicate errors if settings already failed
            if (!error) setError(errMsg);
            toast.error(errMsg);
        } finally {
            setIsLoadingEvents(false);
        }
    }, [eventLimit]);

    // NEW: Fetch Formations
    const fetchFormations = useCallback(async () => {
        setIsLoadingFormations(true);
        try {
            const fetchedFormations = await getFormations();
            setFormations(fetchedFormations);
        } catch (err: any) {
            console.error('Failed to fetch formations:', err);
            const errMsg = err.response?.data?.message || err.message || 'Impossible de charger les formations.';
            toast.error(errMsg);
            setError(errMsg); // Set main error state
        } finally {
            setIsLoadingFormations(false);
        }
    }, []);

    useEffect(() => {
        fetchSettings();
        fetchEvents(1);
        fetchFormations(); // NEW: Fetch formations on component mount
    }, [fetchSettings, fetchEvents, fetchFormations]); // Add fetchFormations to dependencies

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
            setCreateOrUpdateError("Le titre, la description et l'image sont obligatoires (image obligatoire pour un nouvel événement).");
            toast.error("Le titre, la description et l'image de l'événement sont obligatoires (image obligatoire pour un nouvel événement).");
            return;
        }

        setIsCreatingOrUpdatingEvent(true);
        setCreateOrUpdateError(null);
        const toastId = toast.loading(isEditing ? "Mise à jour de l'événement…" : "Création de l'événement…");

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
                toast.success('Événement mis à jour.', { id: toastId });
            } else {
                // Create new event (ensure image is present)
                if (!newEventImage) throw new Error("L'image est obligatoire pour un nouvel événement."); // Should be caught by initial check
                await createEvent({ ...eventData, imageFile: newEventImage });
                toast.success('Événement créé.', { id: toastId });
            }
            resetEventForm();
            fetchEvents(1); // Refresh event list
        } catch (err: any) {
            console.error(isEditing ? 'Failed to update event:' : 'Failed to create event:', err);
            const errMsg = err.response?.data?.message || err.message || (isEditing ? "Impossible de mettre à jour l'événement." : "Impossible de créer l'événement.");
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
        const toastId = toast.loading("Suppression de l'événement…");

        try {
            await deleteEvent(eventToDeleteId);
            toast.success('Événement supprimé.', { id: toastId });
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
            const errMsg = err.response?.data?.message || err.message || "Impossible de supprimer l'événement.";
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
        if (fileRejections.length > 0) toast.error(fileRejections[0].errors[0].message || 'Image non valide.');
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
        if (fileRejections.length > 0) toast.error(fileRejections[0].errors[0].message || 'Vidéo non valide.');
    }, [newEventVideoPreview, isEditing]); // Added isEditing dependency

    const { getRootProps: getImageRootProps, getInputProps: getImageInputProps, isDragActive: isImageDragActive } = useDropzone({ onDrop: onEventImageDrop, accept: { 'image/*': [] }, maxFiles: 1 });
    const { getRootProps: getVideoRootProps, getInputProps: getVideoInputProps, isDragActive: isVideoDragActive } = useDropzone({ onDrop: onEventVideoDrop, accept: { 'video/*': [] }, maxFiles: 1 });

    // --- Pagination Handlers --- 
    const handleEventPageChange = (newPage: number) => {
        if (newPage > 0 && newPage <= eventTotalPages) {
            fetchEvents(newPage);
        }
    };

    // NEW: Formation Handlers
    const resetFormationForm = () => {
        setNewFormationTitle('');
        setNewFormationLink('');
        setNewFormationTier('');
        setNewFormationDecoration('');
        setIsEditingFormation(false);
        setEditingFormationId(null);
        setFormationCreateOrUpdateError(null);
    };

    const handleFormationFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newFormationTitle.trim() || !newFormationLink.trim()) {
            setFormationCreateOrUpdateError('Le titre et le lien de la formation sont obligatoires.');
            toast.error('Le titre et le lien de la formation sont obligatoires.');
            return;
        }

        setIsCreatingOrUpdatingFormation(true);
        setFormationCreateOrUpdateError(null);
        const toastId = toast.loading(isEditingFormation ? 'Mise à jour de la formation…' : 'Création de la formation…');

        const formationData = {
            title: newFormationTitle.trim(),
            link: newFormationLink.trim(),
            requiredSubscriptionType: newFormationTier || '' as '' | 'CLASSIQUE' | 'CIBLE',
            decoration: newFormationDecoration.trim(),
        };

        try {
            if (isEditingFormation && editingFormationId) {
                await updateFormation(editingFormationId, formationData);
                toast.success('Formation mise à jour.', { id: toastId });
            } else {
                await addFormation(formationData);
                toast.success('Formation créée.', { id: toastId });
            }
            resetFormationForm();
            fetchFormations(); // Refresh formation list
        } catch (err: any) {
            console.error(isEditingFormation ? 'Failed to update formation:' : 'Failed to create formation:', err);
            const errMsg = err.response?.data?.message || err.message || (isEditingFormation ? 'Impossible de mettre à jour la formation.' : 'Impossible de créer la formation.');
            setFormationCreateOrUpdateError(errMsg);
            toast.error(errMsg, { id: toastId });
        } finally {
            setIsCreatingOrUpdatingFormation(false);
        }
    };

    const handleEditFormationClick = (formation: IFormation) => {
        setIsEditingFormation(true);
        setEditingFormationId(formation._id);
        setNewFormationTitle(formation.title);
        setNewFormationLink(formation.link);
        setNewFormationTier(formation.requiredSubscriptionType || '');
        setNewFormationDecoration(formation.decoration || '');
        setFormationCreateOrUpdateError(null);
        setTabValue('general'); // Ensure we are on the correct tab
    };

    const handleCancelEditFormation = () => {
        resetFormationForm();
    };

    const handleDeleteFormationClick = (formationId: string) => {
        setFormationToDeleteId(formationId);
        setIsFormationDeleteModalOpen(true);
    };

    const closeFormationDeleteModal = () => {
        setIsFormationDeleteModalOpen(false);
        setFormationToDeleteId(null);
    };

    const confirmDeleteFormationHandler = async () => {
        if (!formationToDeleteId) return;

        setIsDeletingFormation(true);
        const toastId = toast.loading('Suppression de la formation…');

        try {
            await removeFormation(formationToDeleteId);
            toast.success('Formation supprimée.', { id: toastId });
            setFormations(prev => prev.filter(f => f._id !== formationToDeleteId));
            closeFormationDeleteModal();
        } catch (err: any) {
            console.error(`Failed to remove formation ${formationToDeleteId}:`, err);
            const errMsg = err.response?.data?.message || err.message || 'Impossible de supprimer la formation.';
            toast.error(errMsg, { id: toastId });
        } finally {
            setIsDeletingFormation(false);
        }
    };

    // --- Render Logic --- 
    if (isLoadingSettings) {
        return (
            <div className="text-fg flex justify-center items-center h-64">
                <Loader2 className="h-16 w-16 animate-spin text-indigo-600 dark:text-indigo-400" />
            </div>
        );
    }

    if (error && !settings) {
        return (
            <div className="text-fg">
                <div className="p-4 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-md text-red-800 dark:text-red-100">
                    <h2 className="text-lg font-semibold mb-2">Erreur de chargement des paramètres</h2>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    // Tab Button Styling
    const getTabClassName = (value: string) => {
        return `px-4 py-2 text-sm font-medium rounded-md transition-colors duration-150 ease-in-out ${tabValue === value
            ? 'bg-indigo-600 text-white'
            : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
            }`;
    };

    return (
        <div className="text-fg">
            {/* <Header title="Application Settings" /> // Assuming Header component exists */}
            <h1 className="text-2xl font-semibold tracking-tight mb-6 text-fg">Paramètres</h1>

            {/* Main error display if subsequent load fails */}
            {error && (
                <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-md text-red-800 dark:text-red-100 text-sm">
                    {error}
                </div>
            )}

            {/* Tabs Implementation */}
            <div className="mb-6 border-b border-line">
                <nav className="flex space-x-1" aria-label="Onglets">
                    <button onClick={() => handleTabChange('general')} className={getTabClassName('general')}>Général</button>
                    <button onClick={() => handleTabChange('files')} className={getTabClassName('files')}>Fichiers</button>
                    <button onClick={() => handleTabChange('events')} className={getTabClassName('events')}>Événements</button>
                </nav>
            </div>

            {/* Tab Content */}
            <div>
                {/* General Settings Tab - Now for Formations */}
                <div hidden={tabValue !== 'general'}>
                    <WinnerVipLinkCard value={settings?.winnerVipGroupUrl} onSaved={setSettings} />
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Formation Form (Create/Update) */}
                        <div className="lg:col-span-1">
                            <form onSubmit={handleFormationFormSubmit} className="bg-surface border border-line rounded-lg p-6 space-y-4">
                                <h3 className="text-lg font-semibold mb-4 text-fg">
                                    {isEditingFormation ? 'Modifier la formation' : 'Nouvelle formation'}
                                </h3>

                                {/* Formation Title Input */}
                                <div>
                                    <label htmlFor="formationTitle" className="block text-sm font-medium text-fg-muted mb-1">Titre</label>
                                    <input
                                        type="text"
                                        id="formationTitle"
                                        className="block w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg placeholder-fg-subtle"
                                        value={newFormationTitle}
                                        onChange={(e) => setNewFormationTitle(e.target.value)}
                                        required
                                    />
                                </div>

                                {/* Formation Link Input */}
                                <div>
                                    <label htmlFor="formationLink" className="block text-sm font-medium text-fg-muted mb-1">Lien</label>
                                    <input
                                        type="url"
                                        id="formationLink"
                                        className="block w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg placeholder-fg-subtle"
                                        value={newFormationLink}
                                        onChange={(e) => setNewFormationLink(e.target.value)}
                                        required
                                    />
                                </div>

                                {/* Subscription Gate */}
                                <div>
                                    <label htmlFor="formationTier" className="block text-sm font-medium text-fg-muted mb-1">Restriction d'accès</label>
                                    <select
                                        id="formationTier"
                                        className="block w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                                        value={newFormationTier}
                                        onChange={(e) => setNewFormationTier(e.target.value as '' | 'CLASSIQUE' | 'CIBLE')}
                                    >
                                        <option value="">Tous les abonnés actifs</option>
                                        <option value="CLASSIQUE">CLASSIQUE et plus (2150 XAF)</option>
                                        <option value="CIBLE">CIBLE uniquement (5000 XAF)</option>
                                    </select>
                                    <p className="mt-1 text-xs text-fg-muted">Détermine qui voit cette formation dans l'application membre.</p>
                                </div>

                                {/* Decoration */}
                                <div>
                                    <label htmlFor="formationDecoration" className="block text-sm font-medium text-fg-muted mb-1">Décoration (facultatif)</label>
                                    <select
                                        id="formationDecoration"
                                        className="block w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                                        value={newFormationDecoration}
                                        onChange={(e) => setNewFormationDecoration(e.target.value)}
                                    >
                                        <option value="">Aucune</option>
                                        <option value="orange">Mise en avant orange</option>
                                        <option value="gold">Mise en avant dorée</option>
                                        <option value="new">Badge « Nouveau »</option>
                                    </select>
                                    <p className="mt-1 text-xs text-fg-muted">Indication visuelle pour la carte de la formation dans l'application membre.</p>
                                </div>

                                {/* Error Display */}
                                {formationCreateOrUpdateError && (
                                    <div className="p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-md text-red-800 dark:text-red-100 text-sm">
                                        {formationCreateOrUpdateError}
                                    </div>
                                )}

                                {/* Submit Button */}
                                <button
                                    type="submit"
                                    disabled={isCreatingOrUpdatingFormation}
                                    className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-green-500 disabled:opacity-50"
                                >
                                    {isCreatingOrUpdatingFormation ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    {isEditingFormation ? 'Enregistrer la formation' : 'Créer la formation'}
                                </button>
                                {/* Cancel Edit Button */}
                                {isEditingFormation && (
                                    <button
                                        type="button"
                                        onClick={handleCancelEditFormation}
                                        className="w-full mt-2 inline-flex justify-center items-center px-4 py-2 border border-line-strong text-sm font-medium rounded-md text-fg-muted bg-surface-2 hover:bg-surface-3 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-indigo-500"
                                    >
                                        Annuler la modification
                                    </button>
                                )}
                            </form>
                        </div>

                        {/* Formation List */}
                        <div className="lg:col-span-2">
                            <div className="bg-surface border border-line rounded-lg p-6">
                                <h3 className="text-lg font-semibold mb-4 text-fg">Formations existantes</h3>
                                {isLoadingFormations ? (
                                    <div className="flex justify-center items-center p-8">
                                        <Loader2 className="h-8 w-8 animate-spin text-indigo-600 dark:text-indigo-400" />
                                    </div>
                                ) : formations.length === 0 ? (
                                    <p className="text-fg-muted italic">Aucune formation.</p>
                                ) : (
                                    <div className="space-y-4">
                                        {formations.map((formation) => (
                                            <div key={formation._id} className="flex items-start space-x-4 p-4 bg-surface-2 rounded-md">
                                                <div className="grow">
                                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                                        <p className="text-md font-semibold text-fg line-clamp-2">{formation.title}</p>
                                                        {formation.requiredSubscriptionType && (
                                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${formation.requiredSubscriptionType === 'CIBLE' ? 'bg-purple-100 dark:bg-purple-800 text-purple-800 dark:text-purple-100' : 'bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-100'}`}>
                                                                {formation.requiredSubscriptionType} uniquement
                                                            </span>
                                                        )}
                                                        {formation.decoration && (
                                                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 dark:bg-orange-800 text-orange-800 dark:text-orange-100">
                                                                {DECORATION_LABELS[formation.decoration] ?? formation.decoration}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <a href={formation.link} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 dark:text-blue-400 hover:underline break-all">
                                                        {formation.link}
                                                        <ExternalLink className="inline h-3 w-3 ml-1" />
                                                    </a>
                                                </div>
                                                <div className="flex flex-col space-y-1 shrink-0">
                                                    <button
                                                        onClick={() => handleEditFormationClick(formation)}
                                                        className="p-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 focus:outline-hidden"
                                                        title="Modifier la formation" aria-label="Modifier la formation"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteFormationClick(formation._id)}
                                                        className="p-1 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 focus:outline-hidden"
                                                        title="Supprimer la formation" aria-label="Supprimer la formation"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Files Tab */}
                <div hidden={tabValue !== 'files'}>
                    <FileUploadSection
                        title="Logo de l'entreprise"
                        description="Logo principal de l'application (PNG, JPG, GIF, WEBP)."
                        fieldKey="companyLogo"
                        currentFile={settings?.companyLogo}
                        uploadFunction={uploadCompanyLogo}
                        onUploadSuccess={handleFileUploadSuccess}
                        accept={{ 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] }}
                    />
                    <FileUploadSection
                        title="Conditions générales (PDF)"
                        description="Document officiel des conditions générales."
                        fieldKey="termsAndConditionsPdf"
                        currentFile={settings?.termsAndConditionsPdf}
                        uploadFunction={uploadTermsPdf}
                        onUploadSuccess={handleFileUploadSuccess}
                        accept={{ 'application/pdf': ['.pdf'] }}
                    />
                    <FileUploadSection
                        title="Présentation (PDF)"
                        description="Présentation PDF de la plateforme ou de l'entreprise."
                        fieldKey="presentationPdf"
                        currentFile={settings?.presentationPdf}
                        uploadFunction={uploadPresentationPdf}
                        onUploadSuccess={handleFileUploadSuccess}
                        accept={{ 'application/pdf': ['.pdf'] }}
                    />
                    <FileUploadSection
                        title="Vidéo de présentation"
                        description="Vidéo de présentation (MP4, WEBM). Attention à la taille du fichier."
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
                            <form onSubmit={handleEventFormSubmit} className="bg-surface border border-line rounded-lg p-6 space-y-4">
                                {/* Change title based on mode */}
                                <h3 className="text-lg font-semibold mb-4 text-fg">
                                    {isEditing ? "Modifier l'événement" : 'Nouvel événement'}
                                </h3>

                                {/* Event Title Input */}
                                <div>
                                    <label htmlFor="eventTitle" className="block text-sm font-medium text-fg-muted mb-1">Titre</label>
                                    <input
                                        type="text"
                                        id="eventTitle"
                                        className="block w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg placeholder-fg-subtle"
                                        value={newEventTitle}
                                        onChange={(e) => setNewEventTitle(e.target.value)}
                                        required
                                    />
                                </div>

                                {/* Event Description Input */}
                                <div>
                                    <label htmlFor="eventDesc" className="block text-sm font-medium text-fg-muted mb-1">Description</label>
                                    <textarea
                                        id="eventDesc"
                                        rows={3}
                                        className="block w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg placeholder-fg-subtle"
                                        value={newEventDesc}
                                        onChange={(e) => setNewEventDesc(e.target.value)}
                                        required
                                    />
                                </div>

                                {/* Event Image Upload */}
                                <div>
                                    <label className="block text-sm font-medium text-fg-muted mb-1">Image de l'événement (obligatoire)</label>
                                    <div
                                        {...getImageRootProps()}
                                        className={`flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-md cursor-pointer transition-colors ${isImageDragActive ? 'border-indigo-500 bg-surface-2' : 'border-line-strong hover:border-fg-subtle'}`}
                                    >
                                        <input {...getImageInputProps()} />
                                        <UploadCloud className="h-6 w-6 text-fg-subtle mb-1" />
                                        {newEventImage ? (
                                            <p className="text-sm text-fg font-semibold">{newEventImage.name}</p>
                                        ) : (
                                            <p className="text-sm text-fg-muted text-center">Glissez-déposez une image, ou cliquez</p>
                                        )}
                                    </div>
                                    {/* Image Preview - Shows existing when editing, new when selected */}
                                    {newEventImagePreview && (
                                        <div className="mt-2">
                                            <p className="text-xs text-fg-muted mb-1">{isEditing && !newEventImage ? 'Image actuelle :' : 'Nouvelle image :'}</p>
                                            <img src={newEventImagePreview} alt="Aperçu de l'image de l'événement" className="max-h-32 w-auto rounded-sm border border-line-strong" />
                                        </div>
                                    )}
                                </div>

                                {/* Event Video Upload (Optional) */}
                                <div>
                                    <label className="block text-sm font-medium text-fg-muted mb-1">Vidéo de l'événement (facultatif)</label>
                                    <div
                                        {...getVideoRootProps()}
                                        className={`flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-md cursor-pointer transition-colors ${isVideoDragActive ? 'border-indigo-500 bg-surface-2' : 'border-line-strong hover:border-fg-subtle'}`}
                                    >
                                        <input {...getVideoInputProps()} />
                                        <UploadCloud className="h-6 w-6 text-fg-subtle mb-1" />
                                        {newEventVideo ? (
                                            <p className="text-sm text-fg font-semibold">{newEventVideo.name}</p>
                                        ) : (
                                            <p className="text-sm text-fg-muted text-center">Glissez-déposez une vidéo, ou cliquez</p>
                                        )}
                                    </div>
                                    {/* Video Preview - Shows existing when editing, new when selected */}
                                    {newEventVideoPreview && (
                                        <div className="mt-2">
                                            <p className="text-xs text-fg-muted mb-1">{isEditing && !newEventVideo ? 'Vidéo actuelle :' : 'Nouvelle vidéo :'}</p>
                                            <video src={newEventVideoPreview} controls className="max-h-32 w-auto rounded-sm border border-line-strong" />
                                        </div>
                                    )}
                                </div>

                                {/* Error Display */}
                                {createOrUpdateError && (
                                    <div className="p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-md text-red-800 dark:text-red-100 text-sm">
                                        {createOrUpdateError}
                                    </div>
                                )}

                                {/* Submit Button */}
                                <button
                                    type="submit"
                                    disabled={isCreatingOrUpdatingEvent}
                                    className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-green-500 disabled:opacity-50"
                                >
                                    {isCreatingOrUpdatingEvent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : (isEditing ? <UploadCloud className="mr-2 h-4 w-4" /> : <UploadCloud className="mr-2 h-4 w-4" />)}
                                    {isEditing ? "Enregistrer l'événement" : "Créer l'événement"}
                                </button>
                                {/* Cancel Edit Button */}
                                {isEditing && (
                                    <button
                                        type="button" // Important: type=button to prevent form submission
                                        onClick={handleCancelEdit}
                                        className="w-full mt-2 inline-flex justify-center items-center px-4 py-2 border border-line-strong text-sm font-medium rounded-md text-fg-muted bg-surface-2 hover:bg-surface-3 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-indigo-500"
                                    >
                                        Annuler la modification
                                    </button>
                                )}
                            </form>
                        </div>

                        {/* Event List */}
                        <div className="lg:col-span-2">
                            <div className="bg-surface border border-line rounded-lg p-6">
                                <h3 className="text-lg font-semibold mb-4 text-fg">Événements existants</h3>
                                {isLoadingEvents ? (
                                    <div className="flex justify-center items-center p-8">
                                        <Loader2 className="h-8 w-8 animate-spin text-indigo-600 dark:text-indigo-400" />
                                    </div>
                                ) : events.length === 0 ? (
                                    <p className="text-fg-muted italic">Aucun événement.</p>
                                ) : (
                                    <div className="space-y-4">
                                        {events.map((event) => {
                                            // Construct absolute URLs for this event's files
                                            const imageUrl = getEventFileUrl(event.image?.fileId);
                                            const videoUrl = getEventFileUrl(event.video?.fileId);
                                            return (
                                                <div key={event._id} className="flex items-start space-x-4 p-4 bg-surface-2 rounded-md">
                                                    {/* Event Previews Container */}
                                                    <div className="flex space-x-2 shrink-0">
                                                        {/* Event Image Preview - Use new file system */}
                                                        {event.image?.fileId && (
                                                            <ImageDisplay
                                                                fileId={event.image.fileId}
                                                                alt={`Image de l'événement ${event.title}`}
                                                                className="h-16 w-16 object-cover rounded-sm bg-surface-3"
                                                            />
                                                        )}
                                                        {/* Optional Event Video Preview - Use absolute URL */}
                                                        {videoUrl && (
                                                            <video
                                                                src={videoUrl}
                                                                className="h-16 w-auto rounded-sm bg-surface-3"
                                                                preload="metadata"
                                                            />
                                                        )}
                                                    </div>

                                                    <div className="grow">
                                                        {/* Display Event Title */}
                                                        <p className="text-md font-semibold text-fg mb-1 line-clamp-2">{event.title}</p>
                                                        <p className="text-sm text-fg-muted mb-1 line-clamp-3">{event.description}</p>
                                                        <p className="text-xs text-fg-muted">
                                                            Publié le {new Date(event.timestamp || event.createdAt).toLocaleString('fr-FR')}
                                                        </p>
                                                    </div>
                                                    <div className="flex flex-col space-y-1 shrink-0">
                                                        {/* Edit Button */}
                                                        <button
                                                            onClick={() => handleEditClick(event)}
                                                            className="p-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 focus:outline-hidden"
                                                            title="Modifier l'événement" aria-label="Modifier l'événement"
                                                        >
                                                            {/* Use an appropriate edit icon if available */}
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                        </button>
                                                        {/* Delete Button - Now triggers modal */}
                                                        <button
                                                            onClick={() => handleDeleteClick(event._id)} // Use new handler
                                                            className="p-1 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 focus:outline-hidden"
                                                            title="Supprimer l'événement" aria-label="Supprimer l'événement"
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
                                            className="px-3 py-1 rounded-sm bg-surface-2 hover:bg-surface-3 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Précédent
                                        </button>
                                        <span className="text-fg-muted">Page {eventPage} sur {eventTotalPages}</span>
                                        <button
                                            onClick={() => handleEventPageChange(eventPage + 1)}
                                            disabled={eventPage >= eventTotalPages || isLoadingEvents}
                                            className="px-3 py-1 rounded-sm bg-surface-2 hover:bg-surface-3 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Suivant
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Delete Confirmation Modal (Events) */}
            {isDeleteModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 transition-opacity duration-300 ease-in-out" aria-labelledby="modal-title" role="dialog" aria-modal="true">
                    <div className="relative bg-surface rounded-lg text-left overflow-hidden transform transition-all sm:my-8 sm:max-w-lg sm:w-full border border-line">
                        <div className="bg-surface px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                            <div className="sm:flex sm:items-start">
                                <div className="mx-auto shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900 sm:mx-0 sm:h-10 sm:w-10">
                                    <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" aria-hidden="true" />
                                </div>
                                <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                                    <h3 className="text-lg leading-6 font-medium text-fg" id="modal-title">
                                        Supprimer l'événement
                                    </h3>
                                    <div className="mt-2">
                                        <p className="text-sm text-fg-muted">
                                            Voulez-vous vraiment supprimer cet événement ? Cette action est irréversible.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-surface-2 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                            <button
                                type="button"
                                disabled={isDeletingEvent}
                                className="w-full inline-flex justify-center rounded-md border border-transparent px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                                onClick={confirmDeleteHandler}
                            >
                                {isDeletingEvent ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : null}
                                Supprimer
                            </button>
                            <button
                                type="button"
                                className="mt-3 w-full inline-flex justify-center rounded-md border border-line-strong px-4 py-2 bg-surface text-base font-medium text-fg-muted hover:bg-surface-2 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                onClick={closeDeleteModal}
                            >
                                Annuler
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* NEW: Delete Confirmation Modal (Formations) */}
            {isFormationDeleteModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 transition-opacity duration-300 ease-in-out" aria-labelledby="formation-modal-title" role="dialog" aria-modal="true">
                    <div className="relative bg-surface rounded-lg text-left overflow-hidden transform transition-all sm:my-8 sm:max-w-lg sm:w-full border border-line">
                        <div className="bg-surface px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                            <div className="sm:flex sm:items-start">
                                <div className="mx-auto shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900 sm:mx-0 sm:h-10 sm:w-10">
                                    <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" aria-hidden="true" />
                                </div>
                                <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                                    <h3 className="text-lg leading-6 font-medium text-fg" id="formation-modal-title">
                                        Supprimer la formation
                                    </h3>
                                    <div className="mt-2">
                                        <p className="text-sm text-fg-muted">
                                            Voulez-vous vraiment supprimer cette formation ? Cette action est irréversible.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-surface-2 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                            <button
                                type="button"
                                disabled={isDeletingFormation}
                                className="w-full inline-flex justify-center rounded-md border border-transparent px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                                onClick={confirmDeleteFormationHandler}
                            >
                                {isDeletingFormation ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : null}
                                Supprimer
                            </button>
                            <button
                                type="button"
                                className="mt-3 w-full inline-flex justify-center rounded-md border border-line-strong px-4 py-2 bg-surface text-base font-medium text-fg-muted hover:bg-surface-2 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                                onClick={closeFormationDeleteModal}
                            >
                                Annuler
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default SettingsManagementPage; 