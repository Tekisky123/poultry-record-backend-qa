import { Router } from 'express';
const router = Router();
import authRouter from './auth.routes.js';
import userRouter from './user.routes.js';
import vehicleRouter from './vehicle.routes.js';
import vendorRouter from './vendor.routes.js';
import customerRouter from './customer.routes.js';
import tripRouter from './trip.routes.js';
import dashboardRouter from './dashboard.routes.js';
import indirectSaleRouter from './indirectSale.routes.js';
import paymentRouter from './payment.routes.js';
import voucherRouter from './voucher.routes.js';
import groupRouter from './group.routes.js';
import ledgerRouter from './ledger.routes.js';
import dieselStationRouter from './dieselStation.routes.js';
import balanceSheetRouter from './balanceSheet.routes.js';
import securityRouter from './security.routes.js';
import settingRouter from './setting.routes.js';
import inventoryStockRouter from './inventoryStock.routes.js';
// import sendAddSaleSMS from '../services/sms/sendAddSaleSMS.js';

router.use('/auth', authRouter);
router.use('/user', userRouter);
router.use('/vehicle', vehicleRouter);
router.use('/vendor', vendorRouter);
router.use('/customer', customerRouter);
router.use('/trip', tripRouter);
router.use('/dashboard', dashboardRouter);
router.use('/indirect-sales', indirectSaleRouter);
router.use('/payment', paymentRouter);
router.use('/voucher', voucherRouter);
router.use('/group', groupRouter);
router.use('/ledger', ledgerRouter);
router.use('/diesel-stations', dieselStationRouter);
router.use('/balance-sheet', balanceSheetRouter);
router.use('/security', securityRouter);
router.use('/settings', settingRouter);
router.use('/inventory-stock', inventoryStockRouter);
// router.get('/test', (req, res) => {
//     sendAddSaleSMS("7414969691", {
//         customerName: "Tauhid Shaikh",
//         date: "2022-01-01",
//         invoiceNo: "123456",
//         birds: "100",
//         weight: "100",
//         amount: "100",
//         balance: "100"
//     });
//     return res.json({ status: 'OK', timestamp: new Date().toISOString() });
// });

export default router;
