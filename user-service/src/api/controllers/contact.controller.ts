import { Request, Response } from 'express';
import { ContactService } from '../../services/contact.service';
import { ContactSearchFilters } from '../../types/contact.types';
import { UserSex } from '../../database/models/user.model';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { userService } from '../../services/user.service';
import logger from '../../utils/logger';

const log = logger.getLogger('ContactController');

export class ContactController {
    private contactService: ContactService;

    constructor() {
        this.contactService = new ContactService();
    }

    /**
     * Parse and validate contact search filters from request query parameters
     * @param query Request query parameters
     * @returns Validated ContactSearchFilters object
     */
    private parseSearchFilters(query: any): ContactSearchFilters {
        const filters: ContactSearchFilters = {};

        // Parse date filters
        if (query.startDate) {
            filters.registrationDateStart = new Date(query.startDate);
        } else if (query.registrationDateStart) {
            filters.registrationDateStart = new Date(query.registrationDateStart);
        }

        if (query.endDate) {
            filters.registrationDateEnd = new Date(query.endDate);
        } else if (query.registrationDateEnd) {
            filters.registrationDateEnd = new Date(query.registrationDateEnd);
        }

        // Parse sex filter
        if (query.sex && Object.values(UserSex).includes(query.sex)) {
            filters.sex = query.sex as UserSex;
        }

        // Parse age filters
        if (query.minAge && !isNaN(Number(query.minAge))) {
            filters.minAge = Number(query.minAge);
        }

        if (query.maxAge && !isNaN(Number(query.maxAge))) {
            filters.maxAge = Number(query.maxAge);
        }

        // Parse preference categories filter
        if (query.preferenceCategories) {
            if (Array.isArray(query.preferenceCategories)) {
                filters.preferenceCategories = query.preferenceCategories;
            } else if (typeof query.preferenceCategories === 'string') {
                filters.preferenceCategories = query.preferenceCategories.split(',');
            }
        }

        // Parse professions filter (multiple professions)
        if (query.professions) {
            if (Array.isArray(query.professions)) {
                filters.professions = query.professions;
            } else if (typeof query.professions === 'string') {
                // Split by comma and decode URI components
                filters.professions = query.professions.split(',').map((p: string) => decodeURIComponent(p.trim()));
            }
        }

        // Parse single profession filter (backward compatibility)
        if (query.profession) {
            filters.profession = query.profession;
        }

        // Parse country filter
        if (query.country) {
            filters.country = query.country;
        }

        // Parse region filter
        if (query.region) {
            filters.region = query.region;
        }

        // Parse city filter
        if (query.city) {
            filters.city = query.city;
        }

        // Parse language filter
        if (query.language) {
            filters.language = query.language;
        }

        // Parse name filter
        if (query.name) {
            filters.name = query.name;
        }

        // Parse unified search filter (searches name, email, phoneNumber)
        if (query.search) {
            filters.search = query.search;
        }

        // Parse interests filter
        if (query.interests) {
            if (Array.isArray(query.interests)) {
                filters.interests = query.interests;
            } else if (typeof query.interests === 'string') {
                filters.interests = query.interests.split(',').map((i: string) => i.trim());
            }
        }

        // Parse pagination
        if (query.page && !isNaN(Number(query.page))) {
            filters.page = Number(query.page);
        }

        if (query.limit && !isNaN(Number(query.limit))) {
            filters.limit = Number(query.limit);
        }

        return filters;
    }

    /**
     * Search contacts based on filters
     * @param req Express request object
     * @param res Express response object
     */
    async searchContacts(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            // Ensure user is authenticated
            if (!req.user || !req.user.userId) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }

            const userId = req.user.userId.toString();
            const filters = this.parseSearchFilters(req.query);

            const result = await this.contactService.searchContacts(userId, filters);

            res.status(200).json(result);
        } catch (error: any) {
            console.error('Error in searchContacts controller:', error);
            res.status(error.name === 'ValidationError' ? 400 : 500).json({
                error: error.message || 'An error occurred while searching contacts'
            });
        }
    }

    /**
     * Export contacts as VCF file based on filters
     * @param req Express request object
     * @param res Express response object
     */
    async exportContacts(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            // Ensure user is authenticated
            if (!req.user || !req.user.userId) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }

            const userId = req.user.userId.toString();
            const userEmail = req.user.email; // Get user email for sending VCF file
            const filters = this.parseSearchFilters(req.query);

            const vcfResult = await this.contactService.exportContactsAsVCF(userId, filters);

            // Generate filename with current date
            const fileName = `SBC_filtered_contacts_${new Date().toISOString().slice(0, 10)}.vcf`;

            // ASYNC: Send the VCF file as an email attachment in the background
            // This call is not awaited so it doesn't block the HTTP response for the download.
            // Any errors here are logged but do not prevent the file from being downloaded.
            userService.sendContactsVcfEmail(userId, userEmail, vcfResult.content, fileName)
                .catch(emailError => log.error(`Background VCF email send failed for user ${userId}:`, emailError));

            // Set appropriate headers for file download
            res.setHeader('Content-Type', 'text/vcard');
            res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
            res.setHeader('Content-Length', vcfResult.buffer.length);

            // Send the file buffer for download
            res.status(200).send(vcfResult.buffer);
        } catch (error: any) {
            log.error('Error in exportContacts controller:', error);
            res.status(error.name === 'ValidationError' ? 400 : 500).json({
                error: error.message || 'An error occurred while exporting contacts'
            });
        }
    }
} 