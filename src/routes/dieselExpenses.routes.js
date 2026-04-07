import express from 'express';
import { getDieselExpensesMonthlySummary, getDieselExpensesDailyRecords } from '../controllers/dieselExpenses.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

const router = express.Router();

router.get('/monthly-summary', authenticateToken, authorize(["admin", "superadmin"]), getDieselExpensesMonthlySummary);
router.get('/daily-summary', authenticateToken, authorize(["admin", "superadmin"]), getDieselExpensesDailyRecords);

export default router;
