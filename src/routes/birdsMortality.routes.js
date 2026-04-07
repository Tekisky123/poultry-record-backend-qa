import express from 'express';
import { getBirdsMortalityMonthlySummary, getBirdsMortalityDailyRecords } from '../controllers/birdsMortality.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

const router = express.Router();

router.get('/monthly-summary', authenticateToken, authorize(["admin", "superadmin"]), getBirdsMortalityMonthlySummary);
router.get('/daily-summary', authenticateToken, authorize(["admin", "superadmin"]), getBirdsMortalityDailyRecords);

export default router;
