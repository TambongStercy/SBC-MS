import { Request, Response, NextFunction } from 'express';
import { eventService, PaginationParams, UpdateEventData } from '../../services/event.service';
import logger from '../../utils/logger';
import { AppError, BadRequestError, NotFoundError } from '../../utils/errors';
import { Types } from 'mongoose';

const log = logger.getLogger('EventController');

// Interface to type req.files for the fields middleware
interface UploadedFiles {
    imageFile?: Express.Multer.File[];
    videoFile?: Express.Multer.File[];
}

class EventController {

    async createEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
        log.info('Handling POST /events request');
        const { description, timestamp, title } = req.body;
        const files = req.files as UploadedFiles;

        // Validate required fields
        if (!title || typeof title !== 'string' || title.trim() === '') {
            log.warn('Create event request missing or invalid title.');
            return next(new BadRequestError('Event title is required and cannot be empty.'));
        }
        if (!description || typeof description !== 'string' || description.trim() === '') {
            log.warn('Create event request missing or invalid description.');
            return next(new BadRequestError('Event description is required and cannot be empty.'));
        }
        if (!files?.imageFile || files.imageFile.length === 0) {
            log.warn('Create event request missing image file.');
            return next(new BadRequestError('Event image file is required.'));
        }
        if (timestamp && isNaN(Date.parse(timestamp))) {
            log.warn('Create event request received invalid timestamp format:', timestamp);
            return next(new BadRequestError('Invalid timestamp format. Please use ISO 8601 format.'));
        }

        try {
            log.info('Event data validation passed, calling service...');
            // Construct the data object matching the service layer's CreateEventData interface
            const eventData = {
                title: title.trim(),
                description: description.trim(),
                timestamp: timestamp, // Pass timestamp string or undefined
                imageFile: files.imageFile[0], // Pass the actual file object
                videoFile: files.videoFile?.[0], // Pass the video file object or undefined
            };

            const newEvent = await eventService.createEvent(eventData);
            log.info('Event created successfully', { eventId: newEvent._id });
            res.status(201).json({ success: true, data: newEvent, message: 'Event created successfully.' });
        } catch (error: any) {
            log.error('Error creating event:', error);
            next(error);
        }
    }

    async getEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
        log.info('Handling GET /events request...');
        const { limit: limitStr = '10', page: pageStr = '1', sortBy = 'timestamp', sortOrder = 'desc' } = req.query;

        const parsedLimit = parseInt(limitStr as string, 10);
        const parsedPage = parseInt(pageStr as string, 10);

        if (isNaN(parsedLimit) || isNaN(parsedPage) || parsedLimit <= 0 || parsedPage <= 0) {
            return next(new BadRequestError('Invalid pagination parameters: limit and page must be positive integers.'));
        }

        // Validate sortOrder and ensure correct type
        const validSortOrder = (sortOrder === 'asc' || sortOrder === 'desc') ? sortOrder : 'desc';

        try {
            const params: PaginationParams = {
                limit: parsedLimit,
                page: parsedPage,
                sortBy: sortBy as string,
                sortOrder: validSortOrder as 'asc' | 'desc'
            };
            log.debug('Calling eventService.getEvents with params:', params);
            const result = await eventService.getEvents(params);
            res.status(200).json({ success: true, data: result });
        } catch (error: any) {
            log.error('Error fetching events:', error);
            next(error);
        }
    }

    async getEventById(req: Request, res: Response, next: NextFunction): Promise<void> {
        const eventId = req.params.id;
        log.info(`Handling GET /events/${eventId} request...`);

        if (!Types.ObjectId.isValid(eventId)) {
            return next(new BadRequestError('Invalid event ID format.'));
        }

        try {
            log.debug(`Calling eventService.getEventById with ID: ${eventId}`);
            const event = await eventService.getEventById(eventId);
            res.status(200).json({ success: true, data: event });
        } catch (error) {
            log.error(`Error fetching event by ID ${eventId}:`, error);
            if (error instanceof NotFoundError) {
                next(error); // Forward NotFoundError
            } else {
                next(new AppError('Failed to retrieve event.', 500));
            }
        }
    }

    async updateEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
        const eventId = req.params.id;
        log.info(`Handling PUT /events/${eventId} request...`);
        const { description, timestamp, title } = req.body;
        const files = req.files as UploadedFiles;

        if (!Types.ObjectId.isValid(eventId)) {
            return next(new BadRequestError('Invalid event ID format.'));
        }

        // Basic validation for provided fields (optional, service might handle partial updates)
        if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
            return next(new BadRequestError('Event title cannot be empty if provided.'));
        }
        if (description !== undefined && (typeof description !== 'string' || description.trim() === '')) {
            return next(new BadRequestError('Event description cannot be empty if provided.'));
        }
        if (timestamp !== undefined && isNaN(Date.parse(timestamp))) {
            return next(new BadRequestError('Invalid timestamp format. Please use ISO 8601 format.'));
        }

        try {
            const updateData: UpdateEventData = {
                // Only include fields if they are present in the request body
                ...(title !== undefined && { title: title.trim() }),
                ...(description !== undefined && { description: description.trim() }),
                ...(timestamp !== undefined && { timestamp: timestamp }),
                // Pass files if they exist in the multipart request
                ...(files?.imageFile?.[0] && { imageFile: files.imageFile[0] }),
                ...(files?.videoFile?.[0] && { videoFile: files.videoFile[0] }),
                // TODO: How to handle explicit file removal? 
                // Maybe a separate field like `removeVideo: true` in req.body? 
                // For now, only handles replacement.
                // If explicit removal is needed, uncomment and adjust service:
                // ...(req.body.removeVideo && { videoFile: null })
            };

            log.debug(`Calling eventService.updateEvent for ID ${eventId} with data:`, {
                title: updateData.title,
                description: updateData.description,
                timestamp: updateData.timestamp,
                hasNewImage: !!updateData.imageFile,
                hasNewVideo: !!updateData.videoFile
            });

            if (Object.keys(updateData).length === 0 && !files?.imageFile && !files?.videoFile) {
                return next(new BadRequestError('No update data provided (title, description, timestamp, imageFile, or videoFile).'));
            }

            const updatedEvent = await eventService.updateEvent(eventId, updateData);
            log.info(`Event ${eventId} updated successfully.`);
            res.status(200).json({ success: true, data: updatedEvent, message: 'Event updated successfully.' });

        } catch (error: any) {
            log.error(`Error updating event ${eventId}:`, error);
            if (error instanceof NotFoundError) {
                next(error);
            } else {
                next(new AppError('Failed to update event.', 500));
            }
        }
    }

    async deleteEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
        const eventId = req.params.id;
        log.info(`Handling DELETE /events/${eventId} request...`);

        if (!Types.ObjectId.isValid(eventId)) {
            return next(new BadRequestError('Invalid event ID format.'));
        }

        try {
            log.debug(`Calling eventService.deleteEvent with ID: ${eventId}`);
            await eventService.deleteEvent(eventId);
            log.info(`Event ${eventId} deleted successfully.`);
            res.status(204).send(); // No content on successful deletion
        } catch (error) {
            log.error(`Error deleting event by ID ${eventId}:`, error);
            if (error instanceof NotFoundError) {
                next(error); // Forward NotFoundError
            } else {
                next(new AppError('Failed to delete event.', 500));
            }
        }
    }
}

export const eventController = new EventController(); 