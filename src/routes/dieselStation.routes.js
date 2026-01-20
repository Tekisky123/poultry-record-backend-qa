import express from 'express';
import {
  createDieselStation,
  getDieselStations,
  updateDieselStation,
  deleteDieselStation
} from '../controllers/dieselStation.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

const router = express.Router();

router.post('/', authenticateToken, authorize(['superadmin', 'admin']), createDieselStation);
router.get('/', authenticateToken, authorize(['superadmin', 'admin', 'supervisor']), getDieselStations);
router.put('/:id', authenticateToken, authorize(['superadmin', 'admin']), updateDieselStation);
router.delete('/:id', authenticateToken, authorize(['superadmin', 'admin']), deleteDieselStation);

export default router;

