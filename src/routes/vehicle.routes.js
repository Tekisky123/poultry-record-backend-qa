import express from 'express';
const router = express.Router();

import * as vehicleController from '../controllers/vehicle.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';


router.post('/', authenticateToken, authorize(["superadmin","admin",]), vehicleController.addVehicle);
router.get('/', authenticateToken, authorize(["superadmin","admin","supervisor"]), vehicleController.getVehicles);
router.get('/:id', authenticateToken, authorize(["superadmin","admin","supervisor"]), vehicleController.getVehicleById);
router.put('/:id', authenticateToken, authorize(["superadmin","admin",]), vehicleController.updateVehicle);
router.delete('/:id', authenticateToken, authorize(["superadmin","admin",]), vehicleController.deleteVehicle);

export default router;