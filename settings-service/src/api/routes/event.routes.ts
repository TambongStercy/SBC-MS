import express from 'express';
import { eventController } from '../controllers/event.controller';
import { upload } from '../middleware/multer.config'; // Import the shared Multer instance
import authenticate from '../middleware/auth.middleware';

const router = express.Router();

// Middleware to handle potential file uploads for create/update
// Using .fields() to allow optional image and video files simultaneously
const eventUploadMiddleware = upload.fields([
    { name: 'imageFile', maxCount: 1 },
    { name: 'videoFile', maxCount: 1 },
]);

// --- Public Event Routes ---
// GET /events - List events (paginated, sorted)
router.get('/', eventController.getEvents);

// GET /events/:id - Get a specific event by ID
router.get('/:id', eventController.getEventById);

// --- Authenticated Event Routes (Admin Only?) ---
// Apply authentication middleware for creating and deleting events
router.use(authenticate); // Consider adding role-based authorization (e.g., authorize(['admin'])) if needed

// POST /events - Create a new event
// Uses multer.fields to handle multiple file fields
router.post(
    '/',
    eventUploadMiddleware,
    eventController.createEvent
);

// PUT /events/:id - Update an existing event (handles optional file uploads)
router.put('/:id', eventUploadMiddleware, eventController.updateEvent);

// DELETE /events/:id - Delete an event by ID
router.delete('/:id', eventController.deleteEvent);

export default router; 