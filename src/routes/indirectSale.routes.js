import express from 'express';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';
import * as indirectSaleController from '../controllers/indirectSale.controller.js';

const router = express.Router();

router.use(authenticateToken);

router.post(
    '/',
    authorize(['admin', 'superadmin']),
    indirectSaleController.createIndirectSale
);

router.get(
    '/',
    authorize(['admin', 'superadmin']),
    indirectSaleController.getIndirectSales
);

router.get(
    '/stats/monthly',
    authorize(['admin', 'superadmin']),
    indirectSaleController.getMonthlyStats
);

router.get(
    '/stats/daily',
    authorize(['admin', 'superadmin']),
    indirectSaleController.getDailyStats
);

router.get(
    '/:id',
    authorize(['admin', 'superadmin']),
    indirectSaleController.getIndirectSaleById
);

router.put(
    '/:id',
    authorize(['admin', 'superadmin']),
    indirectSaleController.updateIndirectSaleDetails
);

router.post(
    '/:id/purchases',
    authorize(['admin', 'superadmin']),
    indirectSaleController.addPurchase
);

router.put(
    '/:id/purchases/:purchaseId',
    authorize(['admin', 'superadmin']),
    indirectSaleController.updatePurchase
);

router.delete(
    '/:id/purchases/:purchaseId',
    authorize(['admin', 'superadmin']),
    indirectSaleController.deletePurchase
);

router.put(
    '/:id/mortality',
    authorize(['admin', 'superadmin']),
    indirectSaleController.updateMortality
);

router.put(
    '/:id/sales',
    authorize(['admin', 'superadmin']),
    indirectSaleController.updateSales
);

export default router;

