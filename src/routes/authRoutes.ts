import { Router } from 'express';
import { dbGuard, authMiddleware } from '../middleware/authMiddleware.js';
import * as authController from '../controllers/authController.js';

const router = Router();

// Login
router.post('/login', dbGuard, authController.login);

// Register
router.post('/register', dbGuard, authController.register);

// Logout
router.get('/logout', authMiddleware, authController.logout);

// Auth Status (Heartbeat)
router.get('/status', authMiddleware, authController.authStatus);

export default router;

