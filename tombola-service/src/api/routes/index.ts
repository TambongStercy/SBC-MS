import { Router } from 'express';
import tombolaRoutes from './tombola.routes';
// import adminRoutes from './admin.routes'; // Removed import for merged admin routes

const router = Router();

// Mount all tombola-related routes (including nested /admin) under /tombolas
router.use('/tombolas', tombolaRoutes);
// router.use('/admin', adminRoutes); // Removed mounting for merged admin routes

export default router; 