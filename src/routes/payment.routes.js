import express from 'express';
const router = express.Router();

import * as paymentController from '../controllers/payment.controller.js';
import authenticateToken from '../middleware/authenticateToken.js';
import authorize from '../middleware/authorization.js';

// Customer panel routes
router.post('/submit', authenticateToken, authorize(['customer']), paymentController.submitPayment);
router.get('/customer/:id', authenticateToken, authorize(['customer']), paymentController.getCustomerPayments);

// Admin panel routes
router.get('/admin/pending', authenticateToken, authorize(['admin', 'superadmin']), paymentController.getPendingPayments);
router.get('/admin/stats', authenticateToken, authorize(['admin', 'superadmin']), paymentController.getPaymentStats);
router.get('/:id', authenticateToken, authorize(['admin', 'superadmin']), paymentController.getPaymentById);
router.put('/:id/verify', authenticateToken, authorize(['admin', 'superadmin']), paymentController.verifyPayment);

export default router;
