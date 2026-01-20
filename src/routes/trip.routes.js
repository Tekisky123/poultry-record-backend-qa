import express from 'express';
const router = express.Router();

import * as tripController from '../controllers/trip.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

// Trip CRUD operations (Supervisor can create, Admin/Superadmin can view)
router.post('/', authenticateToken, authorize(['supervisor']), tripController.addTrip);
router.get('/', authenticateToken, authorize(['admin', 'superadmin', 'supervisor']), tripController.getTrips);
router.get('/stats/monthly', authenticateToken, authorize(['admin', 'superadmin', 'supervisor']), tripController.getMonthlyTripStats);
router.get('/stats/daily', authenticateToken, authorize(['admin', 'superadmin', 'supervisor']), tripController.getDailyTripStats);
router.get('/stats/overview', authenticateToken, authorize(['admin', 'superadmin', 'supervisor']), tripController.getTripStats);
router.get('/:id', authenticateToken, authorize(['admin', 'superadmin', 'supervisor']), tripController.getTripById);
router.put('/:id', authenticateToken, authorize(['admin', 'superadmin']), tripController.updateTrip);
router.delete('/:id', authenticateToken, authorize(['superadmin']), tripController.deleteTrip);

// Trip management operations (Supervisor)
router.post('/:id/purchase', authenticateToken, authorize(['supervisor']), tripController.addPurchase);
router.put('/:id/purchase/:index', authenticateToken, authorize(['admin', 'superadmin', 'supervisor']), tripController.editPurchase);
router.post('/:id/sale', authenticateToken, authorize(['supervisor']), tripController.addSale);
router.put('/:id/sale/:index', authenticateToken, authorize(['admin', 'superadmin', 'supervisor']), tripController.editSale);
router.put('/:id/diesel', authenticateToken, authorize(['supervisor']), tripController.updateTripDiesel);
router.put('/:id/diesel/:index', authenticateToken, authorize(['admin', 'superadmin', 'supervisor']), tripController.editDieselStation);
router.put('/:id/expenses', authenticateToken, authorize(['supervisor']), tripController.updateTripExpenses);
router.put('/:id/expenses/:index', authenticateToken, authorize(['admin', 'superadmin', 'supervisor']), tripController.editExpense);
// Stock management routes
router.post('/:id/stock', authenticateToken, authorize(['supervisor']), tripController.addStock);
router.put('/:id/stock/:index', authenticateToken, authorize(['admin', 'superadmin', 'supervisor']), tripController.updateStock);
router.delete('/:id/stock/:index', authenticateToken, authorize(['supervisor']), tripController.deleteStock);
router.put('/:id/death-birds', authenticateToken, authorize(['supervisor']), tripController.addDeathBirds);
router.put('/:id/complete', authenticateToken, authorize(['supervisor']), tripController.completeTrip);
router.put('/:id/complete-details', authenticateToken, authorize(['supervisor']), tripController.completeTripDetails);
router.put('/:id/status', authenticateToken, authorize(['supervisor']), tripController.updateTripStatus);

// Trip transfer routes (Supervisor)
router.post('/:id/transfer', authenticateToken, authorize(['supervisor']), tripController.transferTrip);
router.get('/:id/transfer-history', authenticateToken, authorize(['admin', 'superadmin', 'supervisor']), tripController.getTripTransferHistory);

export default router;