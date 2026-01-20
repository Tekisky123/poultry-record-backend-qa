import express from 'express';
const router = express.Router();

import * as voucherController from '../controllers/voucher.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

// All voucher routes require admin or superadmin access
router.post('/', authenticateToken, authorize(["admin", "superadmin"]), voucherController.createVoucher);
router.get('/next-number', authenticateToken, authorize(["admin", "superadmin"]), voucherController.getNextVoucherNumber);
router.get('/', authenticateToken, authorize(["admin", "superadmin"]), voucherController.getVouchers);
router.get('/stats', authenticateToken, authorize(["admin", "superadmin"]), voucherController.getVoucherStats);
router.get('/export', authenticateToken, authorize(["admin", "superadmin"]), voucherController.exportVouchers);
router.get('/:id', authenticateToken, authorize(["admin", "superadmin"]), voucherController.getVoucherById);
router.put('/:id', authenticateToken, authorize(["admin", "superadmin"]), voucherController.updateVoucher);
router.delete('/:id', authenticateToken, authorize(["admin", "superadmin"]), voucherController.deleteVoucher);

export default router;
