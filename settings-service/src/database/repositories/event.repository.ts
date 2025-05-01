import EventModel, { IEvent } from '../models/event.model';
import logger from '../../utils/logger';
import { FilterQuery, SortOrder, Types, UpdateQuery } from 'mongoose';
import { AppError, NotFoundError } from '../../utils/errors';

const log = logger.getLogger('EventRepository');

class EventRepository {
    /**
     * Creates a new Event document.
     * @param data - The data for the new event.
     * @returns The newly created event document.
     */
    async create(data: Partial<Omit<IEvent, '_id' | 'createdAt' | 'updatedAt'>>): Promise<IEvent> {
        log.debug('Creating new event...', data);
        try {
            const event = new EventModel(data);
            const savedEvent = await event.save();
            log.info(`Event created successfully with ID: ${savedEvent._id}`);
            return savedEvent;
        } catch (error: any) {
            log.error('Error creating event:', error);
            throw new AppError('Failed to create event in database.', 500);
        }
    }

    /**
     * Finds an event by its ID.
     * @param id - The ID of the event.
     * @returns The event document or null if not found.
     */
    async findById(id: string | Types.ObjectId): Promise<IEvent | null> {
        log.debug(`Finding event by ID: ${id}`);
        try {
            if (!Types.ObjectId.isValid(id)) {
                log.warn('Invalid event ID format provided.');
                return null;
            }
            const event = await EventModel.findById(id).lean().exec();
            if (!event) {
                return null;
            }
            log.debug(`Event found with ID: ${id}`);
            return event;
        } catch (error: any) {
            log.error(`Error finding event by ID ${id}:`, error);
            throw new AppError('Database error while finding event.', 500);
        }
    }

    /**
     * Finds multiple events based on a filter query, with pagination and sorting.
     * @param filter - MongoDB query object.
     * @param limit - Maximum number of results to return.
     * @param skip - Number of results to skip.
     * @param sort - Sort order object.
     * @returns An array of event documents.
     */
    async find(
        filter: FilterQuery<IEvent> = {},
        limit: number = 10,
        skip: number = 0,
        sort: { [key: string]: SortOrder | { $meta: any } } = { timestamp: -1 }
    ): Promise<IEvent[]> {
        log.debug('Finding events with filter:', { filter, limit, skip, sort });
        try {
            return await EventModel.find(filter)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean()
                .exec();
        } catch (error: any) {
            log.error('Error finding events:', error);
            throw new AppError('Database error while finding events.', 500);
        }
    }

    /**
     * Counts documents matching a filter.
     * @param filter - MongoDB query object.
     * @returns The total count of matching documents.
     */
    async count(filter: FilterQuery<IEvent> = {}): Promise<number> {
        log.debug('Counting events with filter:', filter);
        try {
            return await EventModel.countDocuments(filter).exec();
        } catch (error: any) {
            log.error('Error counting events:', error);
            throw new AppError('Database error while counting events.', 500);
        }
    }

    /**
     * Updates an event by its ID.
     * @param id - The ID of the event to update.
     * @param data - The data to update.
     * @returns The updated event document or null if not found.
     */
    async updateById(id: string, updateData: UpdateQuery<IEvent>): Promise<IEvent | null> {
        log.debug(`Updating event by ID: ${id} with data:`, updateData);
        try {
            if (!Types.ObjectId.isValid(id)) {
                log.warn('Invalid event ID format provided for update.');
                return null;
            }
            const updatedEvent = await EventModel.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).lean().exec();
            if (!updatedEvent) {
                log.warn(`Event with ID ${id} not found for update.`);
            }
            return updatedEvent;
        } catch (error: any) {
            log.error(`Error updating event by ID ${id}:`, error);
            throw new AppError('Database error while updating event.', 500);
        }
    }

    /**
     * Deletes an event by its ID.
     * @param id - The ID of the event to delete.
     * @returns True if deleted, false if not found.
     */
    async deleteById(id: string | Types.ObjectId): Promise<boolean> {
        log.debug(`Deleting event by ID: ${id}`);
        try {
            if (!Types.ObjectId.isValid(id)) {
                log.warn('Invalid event ID format provided for deletion.');
                return false;
            }
            const result = await EventModel.findByIdAndDelete(id).exec();
            if (!result) {
                log.warn(`Event ${id} not found for deletion.`);
                return false;
            }
            log.info(`Event ${id} deleted successfully.`);
            return true;
        } catch (error: any) {
            log.error(`Error deleting event by ID ${id}:`, error);
            throw new AppError('Database error while deleting event.', 500);
        }
    }
}

export default EventRepository; 