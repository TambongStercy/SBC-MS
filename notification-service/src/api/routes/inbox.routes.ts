import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import InboxItemModel from '../../database/models/inbox-item.model';

/**
 * The member's in-app notification list (the bell in the app's header).
 * Base path: /api/notifications/inbox
 */
const router = Router();
router.use(authenticate);

const me = (req: AuthenticatedRequest) => new mongoose.Types.ObjectId(req.user!.userId);
const unreadOf = (userId: mongoose.Types.ObjectId) => InboxItemModel.countDocuments({ userId, readAt: { $exists: false } });

/** Newest first, 30 at a time; ?before=<ISO date> for the next page. */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    const userId = me(req);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '30'), 10) || 30, 1), 50);
    const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
    const items = await InboxItemModel.find({
        userId,
        ...(before && !isNaN(before.getTime()) ? { createdAt: { $lt: before } } : {}),
    }).sort({ createdAt: -1 }).limit(limit).select('category title body url tag readAt createdAt').lean();
    res.status(200).json({ success: true, data: { items, unread: await unreadOf(userId), hasMore: items.length === limit } });
});

/** The number on the bell. */
router.get('/unread-count', async (req: AuthenticatedRequest, res: Response) => {
    res.status(200).json({ success: true, data: { unread: await unreadOf(me(req)) } });
});

/** Marks given notifications read ({ ids }), or all of them ({ all: true }). */
router.post('/read', async (req: AuthenticatedRequest, res: Response) => {
    const userId = me(req);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: unknown) => typeof id === 'string' && mongoose.isValidObjectId(id)) : [];
    if (req.body?.all !== true && ids.length === 0) {
        res.status(400).json({ success: false, message: 'ids or all is required.' });
        return;
    }
    await InboxItemModel.updateMany(
        { userId, readAt: { $exists: false }, ...(req.body?.all === true ? {} : { _id: { $in: ids } }) },
        { $set: { readAt: new Date() } },
    );
    res.status(200).json({ success: true, data: { unread: await unreadOf(userId) } });
});

/** Clears the whole list. */
router.delete('/', async (req: AuthenticatedRequest, res: Response) => {
    await InboxItemModel.deleteMany({ userId: me(req) });
    res.status(200).json({ success: true, data: { unread: 0 } });
});

/** Removes one notification. */
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
    const userId = me(req);
    if (mongoose.isValidObjectId(req.params.id)) await InboxItemModel.deleteOne({ _id: req.params.id, userId });
    res.status(200).json({ success: true, data: { unread: await unreadOf(userId) } });
});

export default router;
