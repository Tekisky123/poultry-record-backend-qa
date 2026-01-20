import express from 'express';
import { getSettings, updateSetting } from '../controllers/setting.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

const router = express.Router();

// Only Super Admin can manage system settings
router.get('/', authenticateToken, authorize(['superadmin']), getSettings);
router.post('/', authenticateToken, authorize(['superadmin']), updateSetting);

export default router;
