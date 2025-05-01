import { Request, Response, NextFunction } from 'express';
import { Types, FilterQuery } from 'mongoose';
import { IFlashSale, FlashSaleStatus } from '../../database/models/flashsale.model';
// Define AuthenticatedRequest interface matching expected structure
interface AuthenticatedRequest extends Request {
    user?: {
        id: string; // Use 'id' as expected by existing types
        email: string;
        role: string;
    };
}
// import { AuthenticatedRequest } from '../middleware/auth.middleware'; // Assuming this type exists
import logger from '../../utils/logger'; // Assuming logger exists
import { flashSaleService } from '../../services/flashsale.service';
import { AppError } from '../../utils/errors';

const log = logger.getLogger('FlashSaleController');

class FlashSaleController {

    // POST /api/flash-sales
    async createFlashSale(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const userId = req.user?.id;
        const userRole = req.user?.role;
        log.info(`User ${userId} (Role: ${userRole}) attempting to create flash sale with data:`, req.body);
        try {
            if (!userId || !userRole) {
                throw new AppError('Authentication required (userId and role)', 401);
            }
            const newFlashSale = await flashSaleService.createFlashSale(userId, userRole, req.body);
            res.status(201).json({ success: true, message: 'Flash sale creation initiated (pending payment)', data: newFlashSale });
        } catch (error) {
            log.error(`Error creating flash sale for user ${userId}:`, error);
            next(error);
        }
    }

    // GET /api/flash-sales
    async getActiveFlashSales(req: Request, res: Response, next: NextFunction): Promise<void> {
        log.info('Fetching active flash sales');
        try {
            const { page = 1, limit = 20 } = req.query;
            const result = await flashSaleService.getActiveFlashSales({
                page: Number(page),
                limit: Number(limit)
            });
            res.status(200).json({ success: true, data: result });
        } catch (error) {
            log.error('Error fetching active flash sales:', error);
            next(error);
        }
    }

    // GET /api/flash-sales/my
    async getMyFlashSales(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const userId = req.user?.id;
        log.info(`Fetching flash sales for user ${userId}`);
        try {
            if (!userId) {
                throw new AppError('Authentication required', 401);
            }
            const { page = 1, limit = 20 } = req.query;
            const result = await flashSaleService.getMyFlashSales(userId, {
                page: Number(page),
                limit: Number(limit)
            });
            res.status(200).json({ success: true, data: result });
        } catch (error) {
            log.error(`Error fetching flash sales for user ${userId}:`, error);
            next(error);
        }
    }

    // PUT /api/flash-sales/:flashSaleId
    async updateFlashSale(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const userId = req.user?.id;
        const flashSaleId = req.params.flashSaleId;
        log.info(`User ${userId} attempting to update flash sale ${flashSaleId}`);
        try {
            if (!userId) {
                throw new AppError('Authentication required', 401);
            }
            const updatedSale = await flashSaleService.updateFlashSale(userId, flashSaleId, req.body);
            if (!updatedSale) {
                throw new AppError('Flash sale not found or update not allowed', 404);
            }
            res.status(200).json({ success: true, message: 'Flash sale updated successfully', data: updatedSale });
        } catch (error) {
            log.error(`Error updating flash sale ${flashSaleId} for user ${userId}:`, error);
            next(error);
        }
    }

    // DELETE /api/flash-sales/:flashSaleId
    async cancelFlashSale(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const userId = req.user?.id;
        const flashSaleId = req.params.flashSaleId;
        log.info(`User ${userId} attempting to cancel flash sale ${flashSaleId}`);
        try {
            if (!userId) {
                throw new AppError('Authentication required', 401);
            }
            await flashSaleService.cancelFlashSale(userId, flashSaleId);
            res.status(200).json({ success: true, message: 'Flash sale cancelled successfully' });
        } catch (error) {
            log.error(`Error cancelling flash sale ${flashSaleId} for user ${userId}:`, error);
            next(error);
        }
    }

    // POST /api/flash-sales/internal/update-payment-status
    async updateFlashSalePaymentStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { sessionId, status } = req.body;
        log.info(`Received internal request to update payment status for intent ${sessionId} to ${status}`);
        try {
            if (!sessionId || (status?.toLowerCase() !== 'succeeded' && status?.toLowerCase() !== 'failed')) {
                throw new AppError('Missing or invalid sessionId or status', 400);
            }
            await flashSaleService.handlePaymentUpdate(sessionId, status.toLowerCase());
            res.status(200).json({ success: true, message: 'Payment status update processed' });
        } catch (error) {
            log.error(`Error handling internal payment status update for intent ${sessionId}:`, error);
            next(error);
        }
    }

    // POST /api/flash-sales/:flashSaleId/track-view
    async trackFlashSaleView(req: Request, res: Response): Promise<void> {
        const { flashSaleId } = req.params;
        log.debug(`Received track view request for flash sale ${flashSaleId}`);
        try {
            if (!Types.ObjectId.isValid(flashSaleId)) {
                // Ignore invalid IDs silently or return 400? Returning 204 for simplicity.
                res.status(204).send();
                return;
            }
            // Fire and forget - don't wait for the service call
            flashSaleService.trackView(flashSaleId);
            // Send response immediately
            res.status(204).send();
        } catch (error: any) {
            // Log error but still return success to client as tracking failure is internal
            log.error(`Error tracking view for flash sale ${flashSaleId}:`, error);
            res.status(204).send();
        }
    }

    // POST /api/flash-sales/:flashSaleId/track-whatsapp-click
    async trackWhatsappClick(req: Request, res: Response): Promise<void> {
        const { flashSaleId } = req.params;
        log.debug(`Received track WhatsApp click request for flash sale ${flashSaleId}`);
        try {
            if (!Types.ObjectId.isValid(flashSaleId)) {
                res.status(204).send();
                return;
            }
            // Fire and forget
            flashSaleService.trackWhatsappClick(flashSaleId);
            // Send response immediately
            res.status(204).send();
        } catch (error: any) {
            log.error(`Error tracking WhatsApp click for flash sale ${flashSaleId}:`, error);
            res.status(204).send();
        }
    }

    // --- Admin Methods ---

    async adminListFlashSales(req: Request, res: Response, next: NextFunction): Promise<void> {
        log.info('[Admin] Request received for listing all flash sales');
        try {
            const { page = 1, limit = 20, sort, ...filters } = req.query;
            const options = {
                page: Number(page),
                limit: Number(limit),
                sort: sort
            };
            const result = await flashSaleService.adminListFlashSales(filters as FilterQuery<IFlashSale>, options);
            res.status(200).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }

    async adminGetFlashSaleDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { flashSaleId } = req.params;
        log.info(`[Admin] Request received for details of flash sale ${flashSaleId}`);
        try {
            const flashSale = await flashSaleService.adminGetFlashSaleById(flashSaleId);
            res.status(200).json({ success: true, data: flashSale });
        } catch (error) {
            next(error);
        }
    }

    async adminUpdateFlashSale(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { flashSaleId } = req.params;
        const updateData = req.body;
        log.info(`[Admin] Request received to update flash sale ${flashSaleId}`);
        try {
            const updatedSale = await flashSaleService.adminUpdateFlashSale(flashSaleId, updateData);
            res.status(200).json({ success: true, message: 'Flash sale updated by admin', data: updatedSale });
        } catch (error) {
            next(error);
        }
    }

    async adminDeleteFlashSale(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { flashSaleId } = req.params;
        log.info(`[Admin] Request received to delete/cancel flash sale ${flashSaleId}`);
        try {
            await flashSaleService.adminDeleteFlashSale(flashSaleId);
            res.status(200).json({ success: true, message: 'Flash sale cancelled by admin' });
        } catch (error) {
            next(error);
        }
    }

    async adminUpdateFlashSaleStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { flashSaleId } = req.params;
        const { status } = req.body;
        log.info(`[Admin] Request received to update status for flash sale ${flashSaleId} to ${status}`);
        try {
            if (!status) {
                throw new AppError('Status is required in the request body', 400);
            }
            const updatedSale = await flashSaleService.adminUpdateFlashSaleStatus(flashSaleId, status as FlashSaleStatus);
            res.status(200).json({ success: true, message: `Flash sale status updated to ${status}`, data: updatedSale });
        } catch (error) {
            next(error);
        }
    }
}

export const flashSaleController = new FlashSaleController(); 