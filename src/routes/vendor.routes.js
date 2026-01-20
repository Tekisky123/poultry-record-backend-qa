import express from 'express';
const router = express.Router();

import * as vendorController from '../controllers/vendor.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

router.post('/', authenticateToken, authorize(["admin", "superadmin"]), vendorController.addVendor);
router.get('/', authenticateToken, authorize(["admin", "superadmin", "supervisor"]), vendorController.getVendors);
router.get('/:id', authenticateToken, authorize(["admin", "superadmin", "supervisor"]), vendorController.getVendorById);
router.get('/:id/ledger', authenticateToken, authorize(["admin", "superadmin", "supervisor"]), vendorController.getVendorLedger);
router.put('/:id', authenticateToken, authorize(["admin", "superadmin"]), vendorController.updateVendor);
router.delete('/:id', authenticateToken, authorize(["admin", "superadmin"]), vendorController.deleteVendor);

export default router;