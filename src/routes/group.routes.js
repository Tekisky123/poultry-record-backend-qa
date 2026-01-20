import express from 'express';
const router = express.Router();

import * as groupController from '../controllers/group.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

router.post('/', authenticateToken, authorize(["admin", "superadmin"]), groupController.addGroup);
router.get('/', authenticateToken, authorize(["admin", "superadmin", "supervisor"]), groupController.getGroups);
router.get('/type/:type', authenticateToken, authorize(["admin", "superadmin"]), groupController.getGroupsByType);
router.get('/:id/summary', authenticateToken, authorize(["admin", "superadmin"]), groupController.getGroupSummary);
router.get('/:id', authenticateToken, authorize(["admin", "superadmin"]), groupController.getGroupById);
router.put('/:id', authenticateToken, authorize(["admin", "superadmin"]), groupController.updateGroup);
router.delete('/:id', authenticateToken, authorize(["admin", "superadmin"]), groupController.deleteGroup);

export default router;

