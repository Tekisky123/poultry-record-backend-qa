import express from 'express';
const router = express.Router();

import * as inventoryController from '../controllers/inventoryStock.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

// Stock Routes
router.use(authenticateToken); // Apply to all

router.post('/purchase', authorize(['supervisor', 'admin', 'superadmin']), inventoryController.addPurchase);
router.post('/sale', authorize(['supervisor', 'admin', 'superadmin']), inventoryController.addSale);
router.post('/receipt', authorize(['supervisor', 'admin', 'superadmin']), inventoryController.addReceipt);
router.post('/mortality', authorize(['supervisor', 'admin', 'superadmin']), inventoryController.addMortality);
router.post('/consume', authorize(['supervisor', 'admin', 'superadmin']), inventoryController.addConsume);
router.post('/weight-loss', authorize(['supervisor', 'admin', 'superadmin']), inventoryController.addWeightLoss);

router.get('/stats/monthly', authorize(['supervisor', 'admin', 'superadmin']), inventoryController.getMonthlyStockStats);
router.get('/stats/daily', authorize(['supervisor', 'admin', 'superadmin']), inventoryController.getDailyStockStats);

router.get('/', authorize(['supervisor', 'admin', 'superadmin']), inventoryController.getStocks);

router.put('/:id', authorize(['supervisor', 'admin', 'superadmin']), inventoryController.updateStock);
router.delete('/:id', authorize(['admin', 'superadmin']), inventoryController.deleteStock);

export default router;
