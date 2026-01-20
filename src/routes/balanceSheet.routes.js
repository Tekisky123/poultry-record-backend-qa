import express from 'express';
const router = express.Router();

import * as balanceSheetController from '../controllers/balanceSheet.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

router.get('/', authenticateToken, authorize(["superadmin", "admin"]), balanceSheetController.getBalanceSheet);

export default router;

