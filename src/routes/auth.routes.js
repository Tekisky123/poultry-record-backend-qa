import express from 'express';
const router = express.Router();

import * as authController from '../controllers/auth.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

// Public signup; approval required for admin/supervisor
router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.get('/verify', authenticateToken, authController.getVerifiedUser);
router.put('/change-password', authenticateToken, authController.changePassword);
// router.patch('/forgot-password', authController.updatePassword);

export default router;