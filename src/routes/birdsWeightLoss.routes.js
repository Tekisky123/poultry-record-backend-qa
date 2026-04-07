import express from 'express';
import { getBirdsWeightLossMonthlySummary, getBirdsWeightLossDailyRecords } from '../controllers/birdsWeightLoss.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

const router = express.Router();

router.get('/monthly-summary', authenticateToken, authorize(["admin", "superadmin"]), getBirdsWeightLossMonthlySummary);
router.get('/daily-summary', authenticateToken, authorize(["admin", "superadmin"]), getBirdsWeightLossDailyRecords);

export default router;
