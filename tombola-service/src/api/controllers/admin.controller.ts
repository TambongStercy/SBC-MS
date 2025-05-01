import { Request, Response, NextFunction } from 'express';
import { tombolaService } from '../../services/tombola.service';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';
import { Types } from 'mongoose'; // Import Types for ObjectId validation
import { TombolaStatus } from '../../database/models/tombolaMonth.model'; // Import enum

const log = logger.getLogger('AdminTombolaController');

class AdminController {

    /**
     * POST /api/admin/tombolas/:monthId/draw
     * Triggers the winner draw for a specific TombolaMonth.
     * Requires admin authentication.
     */
    async performDraw(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { monthId } = req.params;

        if (!Types.ObjectId.isValid(monthId)) {
            res.status(400).json({ success: false, message: 'Invalid Tombola Month ID format.' });
            return;
        }

        log.info(`Admin request to perform draw for TombolaMonth: ${monthId}`);
        // Assuming admin role is verified by preceding middleware

        try {
            const updatedTombola = await tombolaService.drawWinners(monthId);
            log.info(`Draw completed successfully for TombolaMonth ${monthId}.`);
            res.status(200).json({
                success: true,
                message: 'Winner draw performed successfully.',
                data: updatedTombola, // Return the updated tombola month with winners
            });
        } catch (error: any) {
            log.error(`Admin Controller: Error performing draw for TombolaMonth ${monthId}:`, error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error); // Pass unexpected errors to global handler
            }
        }
    }

    /**
     * GET /api/admin/tombolas
     * Retrieves a paginated list of all tombola months for admin.
     */
    async listTombolas(req: Request, res: Response, next: NextFunction): Promise<void> {
        const limit = parseInt(req.query.limit as string) || 20;
        const page = parseInt(req.query.page as string) || 1;
        const skip = (page - 1) * limit;

        log.info(`Admin Controller: Request to list all tombolas (limit: ${limit}, page: ${page})`);
        try {
            const { tombolas, totalCount } = await tombolaService.listAllTombolasAdmin(limit, skip);
            res.status(200).json({
                success: true,
                message: 'Tombola months retrieved successfully.',
                data: tombolas,
                pagination: {
                    page,
                    limit,
                    totalCount,
                    totalPages: Math.ceil(totalCount / limit),
                }
            });
        } catch (error: any) {
            log.error('Admin Controller: Error listing tombolas:', error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * GET /api/admin/tombolas/:monthId/tickets
     * Retrieves a paginated list of tickets for a specific tombola month.
     */
    async listTicketsForMonth(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { monthId } = req.params;
        // Extract pagination and search parameters
        const limit = parseInt(req.query.limit as string) || 15; // Default limit
        const page = parseInt(req.query.page as string) || 1;
        const searchQuery = req.query.search as string | undefined; // Get search query
        const skip = (page - 1) * limit;

        if (!Types.ObjectId.isValid(monthId)) {
            res.status(400).json({ success: false, message: 'Invalid Tombola Month ID format.' });
            return;
        }

        log.info(`Admin Controller: Request to list tickets for month ${monthId} (limit: ${limit}, page: ${page}, search: ${searchQuery || 'none'})`);
        try {
            // Pass searchQuery to the service method
            const { tickets, totalCount } = await tombolaService.listTicketsForMonthAdmin(monthId, limit, skip, searchQuery);
            res.status(200).json({
                success: true,
                message: `Tickets for month ${monthId} retrieved successfully.`,
                data: tickets,
                pagination: {
                    page,
                    limit,
                    totalCount,
                    totalPages: Math.ceil(totalCount / limit),
                }
            });
        } catch (error: any) {
            log.error(`Admin Controller: Error listing tickets for month ${monthId}:`, error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * POST /api/admin/tombolas
     * Creates a new TombolaMonth.
     * Requires admin authentication.
     * Expects { month: number, year: number } in the request body.
     */
    async createTombola(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { month, year } = req.body;

        // Basic validation
        if (typeof month !== 'number' || typeof year !== 'number') {
            res.status(400).json({ success: false, message: 'Invalid input: month and year must be numbers.' });
            return;
        }

        log.info(`Admin Controller: Request to create TombolaMonth for ${year}-${month}`);

        try {
            const newTombola = await tombolaService.createTombolaMonth(month, year);
            log.info(`Admin Controller: Successfully created TombolaMonth ${newTombola._id} for ${year}-${month}`);
            res.status(201).json({
                success: true,
                message: 'Tombola month created successfully.',
                data: newTombola,
            });
        } catch (error: any) {
            log.error(`Admin Controller: Error creating TombolaMonth for ${year}-${month}:`, error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * DELETE /api/tombolas/admin/:monthId
     * Deletes a specific TombolaMonth.
     */
    async deleteTombola(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { monthId } = req.params;

        if (!Types.ObjectId.isValid(monthId)) {
            res.status(400).json({ success: false, message: 'Invalid Tombola Month ID format.' });
            return;
        }

        log.info(`Admin request: Attempting to delete TombolaMonth ${monthId}`);
        try {
            const deleted = await tombolaService.deleteTombolaMonth(monthId);
            if (!deleted) {
                // Service returns false if not found
                throw new AppError('Tombola month not found for deletion.', 404);
            }
            res.status(200).json({ success: true, message: 'Tombola month deleted successfully.' });
        } catch (error: any) {
            log.error(`Admin request failed: Error deleting TombolaMonth ${monthId}:`, error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * PATCH /api/tombolas/admin/:monthId/status
     * Updates the status of a TombolaMonth (OPEN or CLOSED).
     * Expects { status: 'open' | 'closed' } in the request body.
     */
    async updateTombolaStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { monthId } = req.params;
        const { status } = req.body;

        if (!Types.ObjectId.isValid(monthId)) {
            res.status(400).json({ success: false, message: 'Invalid Tombola Month ID format.' });
            return;
        }

        // Validate status input
        let newStatus: TombolaStatus.OPEN | TombolaStatus.CLOSED | undefined;
        if (status === TombolaStatus.OPEN || status === 'open') {
            newStatus = TombolaStatus.OPEN;
        } else if (status === TombolaStatus.CLOSED || status === 'closed') {
            newStatus = TombolaStatus.CLOSED;
        } else {
            res.status(400).json({ success: false, message: 'Invalid status value. Must be \'open\' or \'closed\'.' });
            return;
        }

        log.info(`Admin request: Attempting to update status of TombolaMonth ${monthId} to ${newStatus}`);
        try {
            const updatedTombola = await tombolaService.setTombolaStatus(monthId, newStatus);
            res.status(200).json({
                success: true,
                message: `Tombola month status updated to ${newStatus} successfully.`,
                data: updatedTombola
            });
        } catch (error: any) {
            log.error(`Admin request failed: Error updating status for TombolaMonth ${monthId}:`, error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                next(error);
            }
        }
    }

    /**
     * Controller: Fetch details of a specific tombola month.
     */
    async getTombolaDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
        const log = logger.getLogger('AdminController.getTombolaDetails');
        const { monthId } = req.params;
        log.info(`Admin request: Fetching details for tombola month ID: ${monthId}`);

        try {
            if (!Types.ObjectId.isValid(monthId)) {
                throw new AppError('Invalid Tombola Month ID format.', 400);
            }

            const tombola = await tombolaService.getTombolaById(monthId);

            if (!tombola) {
                throw new AppError('Tombola month not found.', 404);
            }

            log.info(`Admin request successful: Returning details for tombola month ${monthId}`);
            res.json({ success: true, data: tombola });

        } catch (error) {
            log.error(`Admin request failed: Error fetching details for tombola month ${monthId}:`, error);
            next(error); // Pass error to the centralized error handler
        }
    }

    /**
     * Controller: Fetch all ticket numbers for a specific tombola month.
     */
    async getAllTicketNumbers(req: Request, res: Response, next: NextFunction): Promise<void> {
        const log = logger.getLogger('AdminController.getAllTicketNumbers');
        const { monthId } = req.params;
        log.info(`Admin request: Fetching all ticket numbers for tombola month ID: ${monthId}`);

        try {
            if (!Types.ObjectId.isValid(monthId)) {
                throw new AppError('Invalid Tombola Month ID format.', 400);
            }

            const ticketNumbers = await tombolaService.getAllTicketNumbersForMonth(monthId);

            // No need to check for 404 specifically, service will return empty array if no tickets
            log.info(`Admin request successful: Returning ${ticketNumbers.length} ticket numbers for tombola month ${monthId}`);
            res.json({ success: true, data: ticketNumbers });

        } catch (error) {
            log.error(`Admin request failed: Error fetching ticket numbers for tombola month ${monthId}:`, error);
            next(error); // Pass error to the centralized error handler
        }
    }
}

export const adminController = new AdminController(); 