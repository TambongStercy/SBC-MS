import fs from 'fs/promises';
import path from 'path';
import { IUser } from '../database/models/user.model';
import { userService } from './user.service';
import { ContactSearchFilters } from '../types/contact.types';
import logger from '../utils/logger';

const log = logger.getLogger('VCFCacheService');

export class VCFCacheService {
    private readonly vcfFilePath: string;
    private readonly storageDir: string;
    private isGenerating: boolean = false;

    constructor() {
        // Storage directory relative to user-service root
        this.storageDir = path.join(process.cwd(), 'storage');
        this.vcfFilePath = path.join(this.storageDir, 'contacts.vcf');
        log.info(`VCF Cache Service initialized. File path: ${this.vcfFilePath}`);
    }

    /**
     * Ensures the storage directory exists
     */
    private async ensureStorageDirectory(): Promise<void> {
        try {
            await fs.access(this.storageDir);
        } catch (error) {
            log.info('Storage directory does not exist, creating it...');
            await fs.mkdir(this.storageDir, { recursive: true });
        }
    }

    /**
     * Generates VCF content for a single user
     */
    private generateUserVCard(user: Partial<IUser>): string {
        const contact = user as IUser;
        
        const vCardLines = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            // FN and N: Use contact name, append " SBC"
            `FN;CHARSET=UTF-8:${contact.name || 'Unknown'} SBC`,
            `N;CHARSET=UTF-8:;${contact.name || 'Unknown'} SBC;;;`,
            // UID: Use contact ID
            `UID;CHARSET=UTF-8:${contact._id?.toString() || ''}`,
            // TEL: Use phone number
            `TEL;TYPE=CELL:${contact.phoneNumber || ''}`,
            // REV: Use createdAt timestamp in ISO format
            `REV:${contact.createdAt ? new Date(contact.createdAt).toISOString() : new Date().toISOString()}`
        ];

        // Add optional fields if they exist
        if (contact.email) {
            vCardLines.splice(-1, 0, `EMAIL;CHARSET=UTF-8:${contact.email}`);
        }

        if (contact.country) {
            vCardLines.splice(-1, 0, `ADR;TYPE=HOME;CHARSET=UTF-8:;;${contact.region || ''};;${contact.city || ''};${contact.country};`);
        }

        if (contact.profession) {
            vCardLines.splice(-1, 0, `TITLE;CHARSET=UTF-8:${contact.profession}`);
        }

        if (contact.language) {
            vCardLines.splice(-1, 0, `LANG:${contact.language}`);
        }

        if (contact.sex) {
            vCardLines.splice(-1, 0, `X-GENDER:${contact.sex}`);
        }

        // Add birth date if available
        if (contact.birthDate) {
            const birthDate = new Date(contact.birthDate);
            const formattedBirthDate = birthDate.toISOString().split('T')[0].replace(/-/g, '');
            vCardLines.splice(-1, 0, `BDAY:${formattedBirthDate}`);
        }

        // Add interests/categories if available
        if (Array.isArray(contact.interests) && contact.interests.length > 0) {
            vCardLines.splice(-1, 0, `CATEGORIES:${contact.interests.join(',')}`);
        }

        vCardLines.push('END:VCARD');
        return vCardLines.join('\r\n') + '\r\n';
    }

    /**
     * Generates the complete VCF file with all users who have active subscriptions
     */
    async generateVCFFile(): Promise<void> {
        if (this.isGenerating) {
            log.info('VCF file generation already in progress, skipping...');
            return;
        }

        this.isGenerating = true;
        log.info('Starting VCF file generation...');

        try {
            await this.ensureStorageDirectory();

            // Create empty filters to get all users with active subscriptions
            const filters: ContactSearchFilters = {};
            
            let vcfContent = '';
            let totalContacts = 0;

            // Use the existing batch processing method to get all users with active subscriptions
            await userService.findAllUsersByCriteriaInBatches(
                filters,
                true, // filterByActiveSubscription = true
                500,  // batch size
                async (batch) => {
                    for (const user of batch) {
                        vcfContent += this.generateUserVCard(user);
                        totalContacts++;
                    }
                    log.debug(`Processed batch of ${batch.length} users. Total so far: ${totalContacts}`);
                }
            );

            // Write the VCF content to file
            await fs.writeFile(this.vcfFilePath, vcfContent, 'utf8');
            
            log.info(`VCF file generated successfully with ${totalContacts} contacts. File size: ${vcfContent.length} bytes`);
        } catch (error: any) {
            log.error('Error generating VCF file:', error);
            throw error;
        } finally {
            this.isGenerating = false;
        }
    }

    /**
     * Checks if the cached VCF file exists
     */
    async fileExists(): Promise<boolean> {
        try {
            await fs.access(this.vcfFilePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Gets the cached VCF file content
     */
    async getVCFContent(): Promise<string> {
        try {
            const content = await fs.readFile(this.vcfFilePath, 'utf8');
            log.debug(`Retrieved VCF file content. Size: ${content.length} bytes`);
            return content;
        } catch (error: any) {
            log.error('Error reading VCF file:', error);
            throw new Error('Failed to read cached VCF file');
        }
    }

    /**
     * Gets file stats (size, modification time, etc.)
     */
    async getFileStats(): Promise<{ size: number; mtime: Date; contactCount: number }> {
        try {
            const stats = await fs.stat(this.vcfFilePath);
            const content = await this.getVCFContent();
            
            // Count contacts by counting "BEGIN:VCARD" occurrences
            const contactCount = (content.match(/BEGIN:VCARD/g) || []).length;
            
            return {
                size: stats.size,
                mtime: stats.mtime,
                contactCount
            };
        } catch (error: any) {
            log.error('Error getting file stats:', error);
            throw new Error('Failed to get VCF file statistics');
        }
    }

    /**
     * Regenerates the VCF file if it doesn't exist or is older than specified minutes
     */
    async ensureFreshVCFFile(maxAgeMinutes: number = 60): Promise<void> {
        const exists = await this.fileExists();
        
        if (!exists) {
            log.info('VCF file does not exist, generating...');
            await this.generateVCFFile();
            return;
        }

        try {
            const stats = await fs.stat(this.vcfFilePath);
            const ageMinutes = (Date.now() - stats.mtime.getTime()) / (1000 * 60);
            
            if (ageMinutes > maxAgeMinutes) {
                log.info(`VCF file is ${ageMinutes.toFixed(1)} minutes old (max: ${maxAgeMinutes}), regenerating...`);
                await this.generateVCFFile();
            } else {
                log.debug(`VCF file is fresh (${ageMinutes.toFixed(1)} minutes old)`);
            }
        } catch (error: any) {
            log.warn('Error checking file age, regenerating VCF file:', error);
            await this.generateVCFFile();
        }
    }

    /**
     * Deletes the cached VCF file (useful for forcing regeneration)
     */
    async deleteCachedFile(): Promise<void> {
        try {
            await fs.unlink(this.vcfFilePath);
            log.info('Cached VCF file deleted successfully');
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                log.error('Error deleting cached VCF file:', error);
                throw error;
            }
            log.debug('VCF file does not exist, nothing to delete');
        }
    }
}

// Export singleton instance
export const vcfCacheService = new VCFCacheService();
