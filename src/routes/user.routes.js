import express from 'express';
const router = express.Router();

import * as userController from '../controllers/user.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

router.get('/', authenticateToken, authorize(["admin","superadmin", "supervisor"]), userController.getUsers);
router.post('/', authenticateToken, authorize(["admin", "superadmin"]), userController.addUser);
router.get('/:id', authenticateToken, authorize(["admin", "superadmin"]), userController.getUserById);
router.patch('/:id', authenticateToken, authorize(["admin", "superadmin"]), userController.updateUser);
router.delete('/:id', authenticateToken, authorize(["admin", "superadmin"]), userController.deleteUser);
router.get('/approvals/pending', authenticateToken, authorize(["admin","superadmin"]), userController.getPendingApprovals);
router.patch('/:id/approve', authenticateToken, authorize(["admin","superadmin"]), userController.approveUser);
router.patch('/:id/reject', authenticateToken, authorize(["admin","superadmin"]), userController.rejectUser);
router.patch('/:id/status', authenticateToken, authorize(["admin", "superadmin"]), userController.updateUserStatus);

export default router;