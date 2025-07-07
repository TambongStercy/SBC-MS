import { Request, Response } from 'express';
import { ContactService } from '../../services/contact.service';
import { ContactSearchFilters } from '../../types/contact.types';
import { UserSex } from '../../database/models/user.model';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

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
            const filters = this.parseSearchFilters(req.query);

            const vcfBuffer = await this.contactService.exportContactsAsVCF(userId, filters);

            // Set appropriate headers for file download
            res.setHeader('Content-Type', 'text/vcard');
            res.setHeader('Content-Disposition', 'attachment; filename=contacts.vcf');
            res.setHeader('Content-Length', vcfBuffer.length);

            // Send the file
            res.status(200).send(vcfBuffer);
        } catch (error: any) {
            console.error('Error in exportContacts controller:', error);
            res.status(error.name === 'ValidationError' ? 400 : 500).json({
                error: error.message || 'An error occurred while exporting contacts'
            });
        }
    }
} 