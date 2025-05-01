import { Model, Document, FilterQuery, UpdateQuery, QueryOptions, Types } from 'mongoose';
import logger from '../../utils/logger'; // Adjust path as necessary

const log = logger.getLogger('BaseRepository');

export abstract class BaseRepository<T extends Document> {
    protected model: Model<T>;

    constructor(model: Model<T>) {
        this.model = model;
    }

    async findById(id: string | Types.ObjectId): Promise<T | null> {
        log.debug(`Finding document by ID ${id} in ${this.model.modelName}`);
        try {
            return await this.model.findById(id).lean<T>().exec(); // Use lean for performance
        } catch (error) {
            log.error(`Error finding document by ID ${id} in ${this.model.modelName}:`, error);
            throw error;
        }
    }

    async findOne(conditions: FilterQuery<T>): Promise<T | null> {
        log.debug(`Finding one document in ${this.model.modelName} with conditions:`, conditions);
        try {
            return await this.model.findOne(conditions).lean<T>().exec();
        } catch (error) {
            log.error(`Error finding one document in ${this.model.modelName}:`, error);
            throw error;
        }
    }

    async find(conditions: FilterQuery<T>, limit: number = 100, skip: number = 0, sort?: { [key: string]: 1 | -1 }): Promise<T[]> {
        log.debug(`Finding documents in ${this.model.modelName} with conditions:`, { conditions, limit, skip, sort });
        try {
            let query = this.model.find(conditions).skip(skip).limit(limit);
            if (sort) {
                query = query.sort(sort);
            }
            return await query.lean<T[]>().exec();
        } catch (error) {
            log.error(`Error finding documents in ${this.model.modelName}:`, error);
            throw error;
        }
    }

    async updateById(id: string | Types.ObjectId, update: UpdateQuery<T>): Promise<T | null> {
        log.debug(`Updating document by ID ${id} in ${this.model.modelName}`);
        try {
            return await this.model.findByIdAndUpdate(id, update, { new: true }).lean<T>().exec();
        } catch (error) {
            log.error(`Error updating document by ID ${id} in ${this.model.modelName}:`, error);
            throw error;
        }
    }
    
    async updateOne(conditions: FilterQuery<T>, update: UpdateQuery<T>): Promise<T | null> {
        log.debug(`Updating one document in ${this.model.modelName} with conditions:`, conditions);
        try {
            return await this.model.findOneAndUpdate(conditions, update, { new: true }).lean<T>().exec();
        } catch (error) {
            log.error(`Error updating one document in ${this.model.modelName}:`, error);
            throw error;
        }
    }

    async deleteById(id: string | Types.ObjectId): Promise<boolean> {
        log.debug(`Deleting document by ID ${id} in ${this.model.modelName}`);
        try {
            const result = await this.model.deleteOne({ _id: id }).exec();
            return result.deletedCount === 1;
        } catch (error) {
            log.error(`Error deleting document by ID ${id} in ${this.model.modelName}:`, error);
            throw error;
        }
    }

    async count(conditions: FilterQuery<T>): Promise<number> {
        log.debug(`Counting documents in ${this.model.modelName} with conditions:`, conditions);
        try {
            return await this.model.countDocuments(conditions).exec();
        } catch (error) {
            log.error(`Error counting documents in ${this.model.modelName}:`, error);
            throw error;
        }
    }
} 