import express from 'express';
import { downloadBackup } from '../controllers/security.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

const router = express.Router();

// Only superadmin can download backups
router.get('/download-backup', authenticateToken, authorize(['superadmin']), downloadBackup);

export default router;
