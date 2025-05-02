import EventRepository from '../database/repositories/event.repository';
import { IEvent } from '../database/models/event.model';
import { IFileReference } from '../database/models/settings.model';
import GoogleDriveService from './googleDrive.service';
import logger from '../utils/logger';
import { AppError, NotFoundError } from '../utils/errors';
import { FilterQuery, SortOrder, Types } from 'mongoose';

const log = logger.getLogger('EventService');

// Interface for the data needed to create an event
interface CreateEventData {
    title: string;
    description: string;
    timestamp?: Date | string;
    imageFile: Express.Multer.File;
    videoFile?: Express.Multer.File;
}

// Interface for pagination parameters
export interface PaginationParams {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

// Interface for the paginated response
interface PaginatedEventsResponse {
    events: IEvent[];
    totalCount: number;
    currentPage: number;
    totalPages: number;
    limit: number;
}

// Interface for update data
export interface UpdateEventData {
    title?: string;
    description?: string;
    timestamp?: Date | string;
    imageFile?: Express.Multer.File; // Optional new image
    videoFile?: Express.Multer.File; // Optional new video
}

class EventService {
    private repository: EventRepository;

    constructor() {
        this.repository = new EventRepository();
        log.info('EventService initialized.');
    }

    private populateFileUrls(event: IEvent): IEvent {
        if (event.image?.fileId) {
            event.image.url = GoogleDriveService.getProxyFileUrl(event.image.fileId);
        }
        if (event.video?.fileId) {
            event.video.url = GoogleDriveService.getProxyFileUrl(event.video.fileId);
        }
        return event;
    }

    private async uploadFileToDrive(file: Express.Multer.File, prefix: string): Promise<IFileReference> {
        const uniqueFileName = `${prefix}_${Date.now()}_${file.originalname}`;
        try {
            const uploadResult = await GoogleDriveService.uploadFile(
                file.buffer,
                file.mimetype,
                uniqueFileName
            );
            log.info(`${prefix} file uploaded successfully. File ID: ${uploadResult.fileId}`);
            return {
                fileId: uploadResult.fileId,
                fileName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
            };
        } catch (uploadError: any) {
            log.error(`Failed to upload ${prefix} file to Google Drive: ${uploadError.message}`, uploadError);
            throw new AppError(`Failed to upload ${prefix} file to storage.`, 500);
        }
    }

    async createEvent(eventData: CreateEventData): Promise<IEvent> {
        log.info('Creating new event with data:', { title: eventData.title, description: eventData.description, timestamp: eventData.timestamp });

        const imageRef = await this.uploadFileToDrive(eventData.imageFile, 'event_image');
        let videoRef: IFileReference | undefined = undefined;
        if (eventData.videoFile) {
            videoRef = await this.uploadFileToDrive(eventData.videoFile, 'event_video');
        }

        const eventDocument: Partial<IEvent> = {
            title: eventData.title,
            description: eventData.description,
            image: imageRef,
            video: videoRef,
            timestamp: eventData.timestamp ? new Date(eventData.timestamp) : new Date()
        };

        try {
            const createdEvent = await this.repository.create(eventDocument as IEvent);
            log.info('Event created successfully in database', { eventId: createdEvent._id });
            return this.populateFileUrls(createdEvent);
        } catch (dbError: any) {
            log.error('Database error creating event:', dbError);
            throw new AppError('Failed to save event to database.', 500);
        }
    }

    async getEvents(params: PaginationParams = {}): Promise<PaginatedEventsResponse> {
        log.info('Fetching events...', { params });
        const { page = 1, limit = 10, sortBy = 'timestamp', sortOrder = 'desc' } = params;
        const skip = (page - 1) * limit;
        const filter: FilterQuery<IEvent> = {};
        const sortOptions: { [key: string]: SortOrder } = {
            [sortBy]: sortOrder === 'desc' ? -1 : 1
        };

        const [events, totalCount] = await Promise.all([
            this.repository.find(filter, limit, skip, sortOptions),
            this.repository.count(filter)
        ]);

        const populatedEvents = events.map(event => this.populateFileUrls(event));
        const totalPages = Math.ceil(totalCount / limit);

        log.info(`Found ${events.length} events on page ${page}/${totalPages} (Total: ${totalCount})`);
        return {
            events: populatedEvents,
            totalCount,
            currentPage: page,
            totalPages,
            limit
        };
    }

    async getEventById(eventId: string): Promise<IEvent> {
        log.info(`Fetching event by ID: ${eventId}`);
        const event = await this.repository.findById(eventId);
        if (!event) {
            throw new NotFoundError(`Event with ID ${eventId} not found.`);
        }
        return this.populateFileUrls(event);
    }

    async updateEvent(eventId: string, updateData: UpdateEventData): Promise<IEvent> {
        log.info(`Updating event ${eventId} with data:`, {
            title: updateData.title,
            description: updateData.description,
            timestamp: updateData.timestamp,
            hasNewImage: !!updateData.imageFile,
            hasNewVideo: !!updateData.videoFile
        });

        // 1. Find the existing event to get old file IDs if needed
        const existingEvent = await this.repository.findById(eventId);
        if (!existingEvent) {
            throw new NotFoundError(`Event with ID ${eventId} not found for update.`);
        }

        const updatePayload: Partial<IEvent> = {};
        let newImageRef: IFileReference | undefined = undefined;
        let newVideoRef: IFileReference | undefined = undefined;

        // 2. Upload new image if provided
        if (updateData.imageFile) {
            log.debug(`New image provided for event ${eventId}. Uploading...`);
            newImageRef = await this.uploadFileToDrive(updateData.imageFile, 'event_image');
            updatePayload.image = newImageRef;
        }

        // 3. Upload new video if provided
        if (updateData.videoFile) {
            log.debug(`New video provided for event ${eventId}. Uploading...`);
            newVideoRef = await this.uploadFileToDrive(updateData.videoFile, 'event_video');
            updatePayload.video = newVideoRef;
        } else if (updateData.hasOwnProperty('videoFile') && updateData.videoFile === null) {
            // Handle explicit removal of video (if frontend sends null for removal)
            log.debug(`Request to remove video for event ${eventId}.`);
            updatePayload.video = undefined; // Or null depending on schema/repo handling
        }

        // 4. Prepare other fields for update
        if (updateData.title !== undefined) updatePayload.title = updateData.title.trim();
        if (updateData.description !== undefined) updatePayload.description = updateData.description.trim();
        if (updateData.timestamp !== undefined) {
            try {
                updatePayload.timestamp = new Date(updateData.timestamp);
            } catch (dateError) {
                log.warn('Invalid timestamp format during update, ignoring timestamp update.');
                // Or throw BadRequestError
            }
        }

        // 5. Update database
        log.debug(`Calling repository update for event ${eventId} with payload:`, updatePayload);
        const updatedEvent = await this.repository.updateById(eventId, updatePayload);
        if (!updatedEvent) {
            // This might happen in a race condition or if repo logic changes
            log.error(`Failed to update event ${eventId} in database after finding it.`);
            // Cleanup uploaded files if the DB update failed?
            if (newImageRef?.fileId) await GoogleDriveService.deleteFile(newImageRef.fileId).catch(e => log.error(`Cleanup Error: Failed to delete new image ${newImageRef?.fileId}`, e));
            if (newVideoRef?.fileId) await GoogleDriveService.deleteFile(newVideoRef.fileId).catch(e => log.error(`Cleanup Error: Failed to delete new video ${newVideoRef?.fileId}`, e));
            throw new AppError('Failed to save updated event to database.', 500);
        }
        log.info(`Event ${eventId} updated successfully in database.`);

        // 6. Delete old files from Google Drive *after* successful DB update
        if (newImageRef && existingEvent.image?.fileId && existingEvent.image.fileId !== newImageRef.fileId) {
            log.debug(`Deleting old image file ${existingEvent.image.fileId} for event ${eventId}...`);
            GoogleDriveService.deleteFile(existingEvent.image.fileId).catch(err => {
                log.error(`Failed to delete old image file ${existingEvent.image.fileId} for updated event ${eventId}:`, err);
            });
        }
        const oldVideoId = existingEvent.video?.fileId;
        // Delete old video if a new one was uploaded OR if video was explicitly removed
        if (oldVideoId && (newVideoRef || (updateData.hasOwnProperty('videoFile') && updateData.videoFile === null))) {
            if (oldVideoId !== newVideoRef?.fileId) { // Don't delete if somehow the same file was re-uploaded
                log.debug(`Deleting old video file ${oldVideoId} for event ${eventId}...`);
                GoogleDriveService.deleteFile(oldVideoId).catch(err => {
                    log.error(`Failed to delete old video file ${oldVideoId} for updated event ${eventId}:`, err);
                });
            }
        }

        // 7. Populate URLs for response
        return this.populateFileUrls(updatedEvent);
    }

    async deleteEvent(eventId: string): Promise<void> {
        log.info(`Attempting to delete event with ID: ${eventId}`);

        const event = await this.repository.findById(eventId);
        if (!event) {
            throw new NotFoundError(`Event with ID ${eventId} not found for deletion.`);
        }

        const deleted = await this.repository.deleteById(eventId);
        if (!deleted) {
            log.warn(`Event ${eventId} found but failed to delete from database.`);
            throw new AppError('Failed to delete event from database after finding it.', 500);
        }
        log.info(`Event ${eventId} deleted successfully from database.`);

        const filesToDelete: string[] = [];
        if (event.image?.fileId) filesToDelete.push(event.image.fileId);
        if (event.video?.fileId) filesToDelete.push(event.video.fileId);

        if (filesToDelete.length > 0) {
            log.debug(`Attempting to delete ${filesToDelete.length} associated files from Google Drive...`, filesToDelete);
            filesToDelete.forEach(fileId => {
                GoogleDriveService.deleteFile(fileId).catch(err => {
                    log.error(`Failed to delete associated file ${fileId} for deleted event ${eventId} from Google Drive:`, err);
                });
            });
        }
    }
}

export const eventService = new EventService(); 