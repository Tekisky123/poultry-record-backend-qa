import express from 'express';
const router = express.Router();

import * as tripExpensesController from '../controllers/tripExpenses.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

router.get('/monthly-summary', authenticateToken, authorize(["admin", "superadmin"]), tripExpensesController.getTripExpensesMonthlySummary);
router.get('/daily-summary', authenticateToken, authorize(["admin", "superadmin"]), tripExpensesController.getTripExpensesDailyRecords);

export default router;
