import Customer from "../models/Customer.js";
import User from "../models/User.js";
import Trip from "../models/Trip.js";
import IndirectSale from "../models/IndirectSale.js";
import InventoryStock from "../models/InventoryStock.js";
import Group from "../models/Group.js";
import { successResponse } from "../utils/responseHandler.js";
import AppError from "../utils/AppError.js";
import bcrypt from 'bcrypt';
import validator from 'validator';
import mongoose from "mongoose";
import { syncOutstandingBalance } from "../utils/balanceUtils.js";

export const addCustomer = async (req, res, next) => {
    try {
        const { email, password, ...customerData } = req.body;

        // Validate required fields for user creation
        if (!password || !email) {
            throw new AppError('Email and password are required for customer login', 400);
        }

        // Validate email format
        if (!validator.isEmail(email)) {
            throw new AppError('Invalid email format', 400);
        }

        // Validate password strength
        if (!validator.isStrongPassword(password, {
            minLength: 6,
            minLowercase: 1,
            minUppercase: 1,
            minNumbers: 1,
            minSymbols: 0
        })) {
            throw new AppError('Password must contain at least one uppercase letter, one lowercase letter, and one number', 400);
        }

        // Check if user already exists (email or mobile)
        const existingUser = await User.findOne({
            $or: [
                { email: email },
                { mobileNumber: customerData.contact }
            ]
        });

        if (existingUser) {
            throw new AppError('User with this email or mobile number already exists', 400);
        }

        // Automatically find and assign "Sundry Debtors" group for customers
        let groupId = customerData.group;
        if (!groupId) {
            const sundryDebtorsGroup = await Group.findOne({
                slug: 'sundry-debtors',
                isActive: true
            });
            if (!sundryDebtorsGroup) {
                // If slug not found, try fallback to name just in case migration was partial or manual change
                const fallbackGroup = await Group.findOne({ name: 'Sundry Debtors', isActive: true });
                if (!fallbackGroup) {
                    throw new AppError('Sundry Debtors group not found (slug: sundry-debtors). Please contact administrator.', 404);
                }
                groupId = fallbackGroup._id;
            } else {
                groupId = sundryDebtorsGroup._id;
            }
        } else {
            // Validate provided group exists
            const groupDoc = await Group.findById(groupId);
            if (!groupDoc || !groupDoc.isActive) {
                throw new AppError('Group not found or inactive', 404);
            }
        }

        // Hash password
        const hashPassword = await bcrypt.hash(password, 10);

        // Create User account first with mobileNumber synced from customer contact
        const user = new User({
            name: customerData.ownerName || customerData.shopName,
            email: email,
            mobileNumber: customerData.contact, // Sync mobile number from customer contact
            password: hashPassword,
            role: 'customer',
            approvalStatus: 'approved', // Auto-approve customers created by admin
            isActive: true
        });

        const savedUser = await user.save();

        // Create Customer record with user reference
        const openingBalance = customerData.openingBalance || 0;
        const openingBalanceType = customerData.openingBalanceType || 'debit';

        const customer = new Customer({
            ...customerData,
            group: groupId, // Use automatically assigned or provided group
            user: savedUser._id,
            createdBy: req.user._id,
            updatedBy: req.user._id,
            // Set both openingBalance and outstandingBalance to the same initial value
            openingBalance: openingBalance,
            openingBalanceType: openingBalanceType,
            outstandingBalance: openingBalance,
            outstandingBalanceType: openingBalanceType
        });

        const savedCustomer = await customer.save();

        // Update User with customer reference
        savedUser.customer = savedCustomer._id;
        await savedUser.save();

        // Populate customer data for response
        const populatedCustomer = await Customer.findById(savedCustomer._id)
            .populate('user', 'name email mobileNumber role approvalStatus')
            .populate('group', 'name type')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');

        successResponse(res, "New customer added with login credentials!", 201, populatedCustomer);
    } catch (error) {
        next(error);
    }
};

export const getCustomers = async (req, res, next) => {
    try {
        const customers = await Customer.find({ isActive: true })
            .populate('user', 'name email mobileNumber role approvalStatus openingBalance outstandingBalance tdsApplicable')
            .populate('group', 'name type slug')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name')
            .sort({ shopName: 1 });
        successResponse(res, "customers", 200, customers)
    } catch (error) {
        next(error);
    }
};

export const getCustomerById = async (req, res, next) => {
    const { id } = req?.params;
    try {
        const customer = await Customer.findOne({ _id: id, isActive: true })
            .populate('user', 'name email mobileNumber role approvalStatus')
            .populate('group', 'name type slug')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');
        successResponse(res, "customer", 200, customer)
    } catch (error) {
        next(error);
    }
};

export const updateCustomer = async (req, res, next) => {
    const { id } = req?.params;
    try {
        const { password, email, ...customerData } = req.body;

        // Find the customer first
        const customer = await Customer.findById(id);
        if (!customer) {
            return res.status(404).json({ message: "Customer not found" });
        }

        // If user credentials are being updated
        if (customer.user && (password || email)) {
            const userUpdateData = {};

            if (email) {
                if (!validator.isEmail(email)) {
                    throw new AppError('Invalid email format', 400);
                }
                userUpdateData.email = email;
            }

            if (password) {
                if (!validator.isStrongPassword(password, {
                    minLength: 6,
                    minLowercase: 1,
                    minUppercase: 1,
                    minNumbers: 1,
                    minSymbols: 0
                })) {
                    throw new AppError('Password must contain at least one uppercase letter, one lowercase letter, and one number', 400);
                }
                userUpdateData.password = await bcrypt.hash(password, 10);
            }

            // Always sync mobile number from customer contact to user
            userUpdateData.mobileNumber = customerData.contact;

            // Update user if there are changes
            if (Object.keys(userUpdateData).length > 0) {
                await User.findByIdAndUpdate(customer.user, userUpdateData);
            }
        }

        // Automatically set group to "Sundry Debtors" if not provided
        let groupId = customerData.group;
        if (!groupId) {
            const sundryDebtorsGroup = await Group.findOne({
                slug: 'sundry-debtors',
                isActive: true
            });
            if (!sundryDebtorsGroup) {
                // If slug not found, try fallback to name just in case migration was partial or manual change
                const fallbackGroup = await Group.findOne({ name: 'Sundry Debtors', isActive: true });
                if (!fallbackGroup) {
                    throw new AppError('Sundry Debtors group not found (slug: sundry-debtors). Please contact administrator.', 404);
                }
                groupId = fallbackGroup._id;
            } else {
                groupId = sundryDebtorsGroup._id;
            }
        } else {
            // Validate provided group exists
            const groupDoc = await Group.findById(groupId);
            if (!groupDoc || !groupDoc.isActive) {
                throw new AppError('Group not found or inactive', 404);
            }
        }

        // Update customer data
        const updateData = {
            ...customerData,
            group: groupId, // Use automatically assigned or provided group
            updatedBy: req.user._id
        };

        // Handle opening balance update with sync logic
        const isOpeningBalanceChanged = customerData.openingBalance !== undefined || customerData.openingBalanceType !== undefined;

        if (isOpeningBalanceChanged) {
            const newOpeningAmount = customerData.openingBalance !== undefined ? customerData.openingBalance : customer.openingBalance;
            const newOpeningType = customerData.openingBalanceType !== undefined ? customerData.openingBalanceType : customer.openingBalanceType;

            const syncedBalance = syncOutstandingBalance(
                customer.openingBalance,
                customer.openingBalanceType,
                newOpeningAmount,
                newOpeningType,
                customer.outstandingBalance,
                customer.outstandingBalanceType
            );

            updateData.outstandingBalance = syncedBalance.amount;
            updateData.outstandingBalanceType = syncedBalance.type;
        }

        // Set opening balance and type if provided
        if (customerData.openingBalance !== undefined) {
            updateData.openingBalance = customerData.openingBalance;
        }
        if (customerData.openingBalanceType !== undefined) {
            updateData.openingBalanceType = customerData.openingBalanceType;
        }

        const updatedCustomer = await Customer.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate('user', 'name email mobileNumber role approvalStatus')
            .populate('group', 'name type slug')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');

        successResponse(res, "Customer updated successfully", 200, updatedCustomer);
    } catch (error) {
        next(error);
    }
};

export const deleteCustomer = async (req, res, next) => {
    const { id } = req?.params;
    try {
        const customer = await Customer.findByIdAndUpdate(
            id,
            { isActive: false, updatedBy: req.user._id },
            { new: true }
        );

        if (!customer) {
            return res.status(404).json({ message: "Customer not found" });
        }

        successResponse(res, "Customer deleted successfully", 200, customer);
    } catch (error) {
        next(error);
    }
};

export const getCustomerSales = async (req, res, next) => {
    try {
        const { id } = req.params; // user ID

        const customer = await Customer.findOne({ user: id, isActive: true });
        if (!customer) {
            throw new AppError('Customer profile not found', 404);
        }

        // Ensure ID type is ObjectId
        const customerId = new mongoose.Types.ObjectId(customer._id);

        const trips = await Trip.find({ 'sales.client': customerId })
            .populate('sales.client', 'shopName ownerName')
            .populate('supervisor', 'name mobileNumber')
            .populate('vehicle', 'vehicleNumber')
            .sort({ createdAt: -1 });
        // Filter only sales of this customer
        const customerSales = [];
        trips.forEach(trip => {
            trip.sales.forEach(sale => {
                if (sale.client && sale.client._id.toString() === customer._id.toString()) {
                    customerSales.push({
                        _id: sale._id,
                        tripId: trip.tripId,
                        billNumber: sale.billNumber,
                        birds: sale.birds,
                        weight: sale.weight,
                        rate: sale.rate,
                        amount: sale.amount,
                        cashPaid: sale.cashPaid || 0,
                        onlinePaid: sale.onlinePaid || 0,
                        discount: sale.discount || 0,
                        outstandingBalance: sale.outstandingBalance || 0,
                        timestamp: sale.timestamp,
                        trip: {
                            _id: trip._id,
                            tripId: trip.tripId,
                            supervisor: trip.supervisor,
                            vehicle: trip.vehicle,
                            date: trip.date
                        }
                    });
                }
            });
        });

        successResponse(res, "Customer sales retrieved successfully", 200, customerSales);
    } catch (error) {
        next(error);
    }
};


export const getCustomerProfile = async (req, res, next) => {
    try {
        const { id } = req.params; // User ID for customer panel

        const customer = await Customer.findOne({
            user: id,
            isActive: true
        })
            .populate('user', 'name email mobileNumber role approvalStatus createdAt lastLogin')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');

        if (!customer) {
            throw new AppError('Customer profile not found', 404);
        }

        successResponse(res, "Customer profile retrieved successfully", 200, customer);
    } catch (error) {
        next(error);
    }
};

export const updateCustomerProfile = async (req, res, next) => {
    try {
        const { id } = req.params; // User ID for customer panel
        const updateData = req.body;

        // Find customer by user ID
        const customer = await Customer.findOne({ user: id, isActive: true });
        if (!customer) {
            throw new AppError('Customer not found', 404);
        }

        // Update customer data
        const updatedCustomer = await Customer.findByIdAndUpdate(
            customer._id,
            { ...updateData, updatedBy: req.user._id },
            { new: true, runValidators: true }
        ).populate('user', 'name email mobileNumber role approvalStatus');

        // Update user data if provided
        if (updateData.ownerName || updateData.email || updateData.mobileNumber) {
            const userUpdateData = {};
            if (updateData.ownerName) userUpdateData.name = updateData.ownerName;
            if (updateData.email) userUpdateData.email = updateData.email;
            if (updateData.mobileNumber) userUpdateData.mobileNumber = updateData.mobileNumber;

            await User.findByIdAndUpdate(id, userUpdateData);
        }

        successResponse(res, "Customer profile updated successfully", 200, updatedCustomer);
    } catch (error) {
        next(error);
    }
};

export const getCustomerDashboardStats = async (req, res, next) => {
    try {
        const { id } = req.params; // User ID

        const customer = await Customer.findOne({ user: id, isActive: true });
        if (!customer) {
            throw new AppError('Customer profile not found', 404);
        }

        // Ensure ID type is ObjectId
        const customerId = new mongoose.Types.ObjectId(customer._id);

        const trips = await Trip.find({ 'sales.client': customerId })
            .populate('sales.client', 'shopName ownerName')
            .populate('supervisor', 'name mobileNumber')
            .populate('vehicle', 'vehicleNumber')
            .sort({ createdAt: -1 });

        // Fetch Vouchers for "Other" calculations (similar to ledger logic)
        const Voucher = (await import('../models/Voucher.js')).default;
        const vouchers = await Voucher.find({
            voucherType: { $in: ['Payment', 'Receipt', 'Journal'] },
            isActive: true,
            $or: [
                {
                    parties: {
                        $elemMatch: {
                            partyId: customerId,
                            partyType: 'customer'
                        }
                    }
                },
                // For Journal: match via account name if needed (ledger logic uses name)
                { "entries.account": customer.shopName }
            ]
        }).lean();

        // Calculate stats from sales data
        let totalPurchases = 0;
        let totalAmount = 0;
        let totalPaid = 0;
        let totalBirds = 0;
        let totalWeight = 0;
        let pendingPayments = 0;
        let totalDiscountAndOther = 0;

        trips.forEach(trip => {
            trip.sales.forEach(sale => {
                if (sale.client && sale.client._id.toString() === customer._id.toString()) {
                    totalPurchases += 1;
                    totalAmount += sale.amount || 0;
                    totalPaid += (sale.cashPaid || 0) + (sale.onlinePaid || 0);
                    totalBirds += sale.birds || 0;
                    totalWeight += sale.weight || 0;
                    pendingPayments += sale.outstandingBalance || 0;

                    // Add sales discount to Discount & Other
                    if (sale.discount > 0) {
                        totalDiscountAndOther += sale.discount;
                    }
                }
            });
        });

        // Add Voucher amounts to Discount & Other
        // Logic mirrors ledger: 
        // Payment Voucher -> RECEIPT (Excluded)
        // Receipt Voucher -> PAYMENT (Included)
        // Journal Voucher -> JOURNAL (Included)
        vouchers.forEach(voucher => {
            let particulars = '';
            let amount = 0;

            if (voucher.voucherType === 'Payment') {
                particulars = 'RECEIPT';
                const partyData = voucher.parties?.find(p => p.partyId && p.partyId.toString() === customerId.toString());
                amount = partyData ? partyData.amount : 0;
            } else if (voucher.voucherType === 'Receipt') {
                particulars = 'PAYMENT';
                const partyData = voucher.parties?.find(p => p.partyId && p.partyId.toString() === customerId.toString());
                amount = partyData ? partyData.amount : 0;
            } else {
                particulars = 'JOURNAL';
                // Calculate journal amount for this customer
                const entry = voucher.entries?.find(e => e.account === customer.shopName);
                if (entry) {
                    amount = entry.debitAmount !== 0 ? entry.debitAmount : entry.creditAmount;
                }
            }

            // Filter based on user's excluded list
            // Excluded: ['INDIRECT_PURCHASE', 'INDIRECT_SALES', 'SALES', 'PURCHASE', 'BY CASH RECEIPT', 'BY BANK RECEIPT', 'RECEIPT', 'OP BAL']
            // Included: 'PAYMENT' (Receipt Voucher), 'JOURNAL', 'DISCOUNT' (already added)
            const excludedParticulars = ['INDIRECT_PURCHASE', 'INDIRECT_SALES', 'SALES', 'PURCHASE', 'BY CASH RECEIPT', 'BY BANK RECEIPT', 'RECEIPT', 'OP BAL'];

            if (!excludedParticulars.includes(particulars)) {
                totalDiscountAndOther += amount;
            }
        });

        const stats = {
            totalPurchases,
            totalAmount,
            totalPaid,
            totalBalance: totalAmount - totalPaid,
            totalBirds,
            totalWeight,
            pendingPayments,
            openingBalance: customer.openingBalance || 0,
            outstandingBalance: customer.outstandingBalance || 0,
            totalDiscountAndOther
        };

        successResponse(res, "Customer dashboard stats retrieved successfully", 200, stats);
    } catch (error) {
        next(error);
    }
};

export const getCustomerPurchaseLedger = async (req, res, next) => {
    try {
        const { id } = req.params; // User ID
        const { page = 1, limit = 10 } = req.query;

        const customer = await Customer.findOne({ user: id, isActive: true });
        if (!customer) {
            throw new AppError('Customer profile not found', 404);
        }

        // Ensure ID type is ObjectId
        const customerId = new mongoose.Types.ObjectId(customer._id);

        const trips = await Trip.find({ "sales.client": customerId })
            .populate('sales.client', 'shopName ownerName')
            .populate('supervisor', 'name mobileNumber')
            .populate('vehicle', 'vehicleNumber')
            .sort({ createdAt: -1 });

        // Fetch Indirect Sales
        const indirectSales = await IndirectSale.find({
            customer: customerId,
            isActive: true,
            // status: 'completed' // Matches vendor controller manual override
        }).lean().populate('vendor', '_id vendorName');

        // Fetch verified payments for this customer
        // Include all verified payments from Submit Payment popup
        // These are separate payment records that should appear in the ledger
        const Payment = (await import('../models/Payment.js')).default;
        const payments = await Payment.find({
            customer: customerId,
            status: 'verified', // Only include verified payments
            isActive: true
        })
            .populate('trip', 'tripId date')
            .sort({ createdAt: 1 }); // Sort ascending to maintain chronological order

        // Fetch vouchers where this customer is a party in Payment/Receipt vouchers
        const Voucher = (await import('../models/Voucher.js')).default;
        const customerForVoucher = await Customer.findById(customerId);
        const customerName = customerForVoucher ? customerForVoucher.shopName : null;

        const vouchers = await Voucher.find({
            voucherType: { $in: ['Payment', 'Receipt', 'Journal'] },
            isActive: true,
            $or: [
                // 1. Match via parties array
                {
                    parties: {
                        $elemMatch: {
                            partyId: customerId,
                            partyType: 'customer'
                        }
                    }
                },

                // 2. Match via entries.account field (Journal case)
                customerName ? {
                    "entries.account": customerName
                } : {}
            ]
        }).populate('account', 'name')
            .sort({ date: 1, createdAt: 1 });

        // Fetch Inventory Stock Sales (Direct Sales via Manage Stocks)
        const stockSales = await InventoryStock.find({
            customerId: customerId,
            type: { $in: ['sale', 'receipt'] } // Include receipts from Manage Stocks
        }).populate('supervisorId', 'name').populate('vehicleId', 'vehicleNumber').lean();

        // Transform sales into ledger entries
        const ledgerEntries = [];

        // Process Stock Sales (Manage Stocks)
        const stockSaleParticularsTitle = req.user.role === 'customer' ? 'STOCK_PURCHASE' : 'STOCK_SALE';

        stockSales.forEach(stock => {
            let particulars = '';
            if (stock.type === 'sale') {
                particulars = stockSaleParticularsTitle;
            } else if (stock.type === 'receipt') {
                particulars = req.user.role === 'customer' ? 'PAYMENT' : 'RECEIPT';
            }

            // Create main entry
            ledgerEntries.push({
                _id: `stock_${stock._id}`,
                date: stock.date,
                vehiclesNo: stock.vehicleNumber || stock.vehicleId?.vehicleNumber || '-',
                driverName: '-',
                supervisor: stock.supervisorId?.name || '-',
                product: 'Broiler Chicken',
                particulars: particulars,
                invoiceNo: stock.billNumber || stock.refNo || '-',
                birds: stock.birds || 0,
                weight: stock.weight || 0,
                avgWeight: stock.birds > 0 ? (stock.weight / stock.birds) : 0,
                rate: stock.rate || 0,
                amount: stock.amount || 0,
                outstandingBalance: 0, // Calculated later
                trip: null,
                isStockSale: true
            });

            // Handle payments within the sale/receipt
            if (stock.cashPaid > 0) {
                ledgerEntries.push({
                    _id: `stock_${stock._id}_cash`,
                    date: stock.date,
                    vehiclesNo: stock.vehicleNumber || stock.vehicleId?.vehicleNumber || '-',
                    driverName: '-',
                    supervisor: stock.supervisorId?.name || '-',
                    product: '',
                    particulars: 'BY CASH RECEIPT',
                    invoiceNo: stock.billNumber || stock.refNo || '-',
                    birds: 0,
                    weight: 0,
                    avgWeight: 0,
                    rate: 0,
                    amount: stock.cashPaid,
                    outstandingBalance: 0,
                    trip: null
                });
            }
            if (stock.onlinePaid > 0) {
                ledgerEntries.push({
                    _id: `stock_${stock._id}_online`,
                    date: stock.date,
                    vehiclesNo: stock.vehicleNumber || stock.vehicleId?.vehicleNumber || '-',
                    driverName: '-',
                    supervisor: stock.supervisorId?.name || '-',
                    product: '',
                    particulars: 'BY BANK RECEIPT',
                    invoiceNo: stock.billNumber || stock.refNo || '-',
                    birds: 0,
                    weight: 0,
                    avgWeight: 0,
                    rate: 0,
                    amount: stock.onlinePaid,
                    outstandingBalance: 0,
                    trip: null
                });
            }
            if (stock.discount > 0) {
                ledgerEntries.push({
                    _id: `stock_${stock._id}_discount`,
                    date: stock.date,
                    vehiclesNo: stock.vehicleNumber || stock.vehicleId?.vehicleNumber || '-',
                    driverName: '-',
                    supervisor: stock.supervisorId?.name || '-',
                    product: '',
                    particulars: 'DISCOUNT',
                    invoiceNo: stock.billNumber || stock.refNo || '-',
                    birds: 0,
                    weight: 0,
                    avgWeight: 0,
                    rate: 0,
                    amount: stock.discount,
                    outstandingBalance: 0,
                    trip: null
                });
            }
        });

        // Determine particulars primarily based on role, but specific entry types override
        // Admin sees SALES, Customer sees PURCHASE for the same transaction
        const saleParticularsTitle = req.user.role === 'customer' ? 'INDIRECT_PURCHASE' : 'INDIRECT_SALES';
        // Process Indirect Sales
        indirectSales.forEach(sale => {
            // Check if it's a purchase from the customer's perspective (i.e. Company Sold to Customer)
            // Construct the entry
            ledgerEntries.push({
                _id: sale._id, // Use string or objectId
                date: sale.date,
                vehiclesNo: sale.vehicleNumber || '-',
                driverName: sale.driver || '-',
                supervisor: '-',
                product: sale?.vendor?.vendorName || 'Broiler Chicken', // Default product
                particulars: saleParticularsTitle, // PURCHASE (Portal) or SALES (Admin)
                invoiceNo: sale.invoiceNumber || '-',
                birds: sale.sales?.birds || 0,
                weight: sale.sales?.weight || 0,
                avgWeight: sale.sales?.avgWeight || 0,
                rate: sale.sales?.rate || 0,
                amount: sale.sales?.amount || 0,
                outstandingBalance: 0, // Calculated later
                trip: null, // No trip object for indirect
                isIndirect: true
            });
        });

        trips.forEach(trip => {
            trip.sales.forEach(sale => {
                if (sale.client && sale.client._id.toString() == customer._id.toString()) {
                    // Determine particulars based on sale type
                    let particulars = '';
                    if (sale.birds > 0) {
                        particulars = 'SALES';
                    } else if (sale.birds == 0 && sale.weight == 0 && sale.amount == 0) {
                        // This is a receipt entry (payment only)
                        particulars = 'RECEIPT';
                    } else if (sale.birds == 0 && sale.weight == 0 && sale.balance > 0) {
                        // This is an outstanding balance payment entry
                        particulars = 'OP BAL';
                    } else {
                        particulars = 'OTHER';
                    }

                    let byCash = '';
                    let byOnline = '';


                    if (
                        (particulars == 'SALES' || particulars == 'RECEIPT' || particulars == 'OP BAL')
                        &&
                        (sale.cashPaid > 0 || sale.onlinePaid > 0)
                    ) {
                        byCash = sale.cashPaid > 0 ? 'BY CASH RECEIPT' : '';
                        byOnline = sale.onlinePaid > 0 ? 'BY BANK RECEIPT' : '';
                    }


                    // Create main entry (SALES or RECEIPT)
                    // For RECEIPT entries, use balanceForSale (starting balance) since amount=0
                    // For SALES entries, use balanceForSale (balance after adding sale amount)
                    const mainEntryBalance = (particulars === 'RECEIPT')
                        ? (sale.balanceForSale || sale.outstandingBalance || 0) // Receipt: starting balance
                        : (sale.balanceForSale || sale.outstandingBalance || 0); // Sale: balance after adding amount

                    // Use unique IDs for each entry type to prevent duplicates
                    ledgerEntries.push({
                        _id: `sale_${sale._id}_${particulars}`,
                        date: sale.timestamp,
                        vehiclesNo: trip.vehicle?.vehicleNumber || '',
                        driverName: trip.driver || '',
                        supervisor: trip.supervisor?.name || '',
                        product: sale.product || '', // Get vendor name from first purchase
                        particulars: particulars,
                        invoiceNo: sale.billNumber,
                        birds: sale.birds || 0,
                        weight: sale.weight || 0,
                        avgWeight: sale.avgWeight || 0,
                        rate: sale.rate || 0,
                        amount: sale.amount || 0,
                        outstandingBalance: mainEntryBalance,
                        trip: {
                            _id: trip._id,
                            tripId: trip.tripId,
                            supervisor: trip.supervisor,
                            vehicle: trip.vehicle,
                            date: trip.date
                        }
                    });

                    const byCashEntry = {
                        _id: `sale_${sale._id}_cash`,
                        date: sale.timestamp,
                        vehiclesNo: trip.vehicle?.vehicleNumber || '',
                        driverName: trip.driver || '',
                        supervisor: trip.supervisor?.name || '',
                        product: sale.product || '', // Get vendor name from first purchase
                        particulars: byCash,
                        invoiceNo: sale.billNumber,
                        birds: 0,
                        weight: 0,
                        avgWeight: 0,
                        rate: 0,
                        amount: sale.cashPaid || 0,
                        outstandingBalance: sale.balanceForCashPaid || sale.outstandingBalance || 0, // Use balanceForCashPaid for BY CASH RECEIPT particular
                        trip: {
                            _id: trip._id,
                            tripId: trip.tripId,
                            supervisor: trip.supervisor,
                            vehicle: trip.vehicle,
                            date: trip.date
                        }
                    };
                    const byOnlineEntry = {
                        _id: `sale_${sale._id}_online`,
                        date: sale.timestamp,
                        vehiclesNo: trip.vehicle?.vehicleNumber || '',
                        driverName: trip.driver || '',
                        supervisor: trip.supervisor?.name || '',
                        product: sale.product || '', // Get vendor name from first purchase
                        particulars: byOnline,
                        invoiceNo: sale.billNumber,
                        birds: 0,
                        weight: 0,
                        avgWeight: 0,
                        rate: 0,
                        amount: sale.onlinePaid || 0,
                        outstandingBalance: sale.balanceForOnlinePaid || sale.outstandingBalance || 0, // Use balanceForOnlinePaid for BY BANK RECEIPT particular
                        trip: {
                            _id: trip._id,
                            tripId: trip.tripId,
                            supervisor: trip.supervisor,
                            vehicle: trip.vehicle,
                            date: trip.date
                        }
                    }

                    if (byCash != '' && byOnline != '') { // Both cash and online paid
                        ledgerEntries.push(byCashEntry, byOnlineEntry);
                    } else if (byCash != '' && byOnline == '') { // Only cash paid
                        ledgerEntries.push(byCashEntry);
                    } else if (byCash == '' && byOnline != '') { // Only online paid
                        ledgerEntries.push(byOnlineEntry);
                    } else { }


                    // If sale has discount, create separate DISCOUNT entry
                    if (sale.discount > 0) {
                        ledgerEntries.push({
                            _id: `${sale._id}_discount`,
                            date: sale.timestamp,
                            vehiclesNo: trip.vehicle?.vehicleNumber || '',
                            driverName: trip.driver || '',
                            supervisor: trip.supervisor?.name || '',
                            product: sale.product || '',
                            particulars: 'DISCOUNT',
                            invoiceNo: sale.billNumber,
                            birds: 0,
                            weight: 0,
                            avgWeight: 0,
                            rate: 0,
                            amount: sale.discount, // Discount amount goes in amount column
                            outstandingBalance: sale.balanceForDiscount || sale.outstandingBalance || 0, // Use balanceForDiscount for DISCOUNT particular
                            trip: {
                                _id: trip._id,
                                tripId: trip.tripId,
                                supervisor: trip.supervisor,
                                vehicle: trip.vehicle,
                                date: trip.date
                            }
                        });
                    }
                }
            });
        });

        // Add verified payments to ledger entries
        payments.forEach(payment => {
            // Determine particulars based on payment method
            // If paymentMethod is 'cash', it's "BY CASH RECEIPT", otherwise "BY BANK RECEIPT"
            const particulars = payment.paymentMethod === 'cash' ? 'BY CASH RECEIPT' : 'BY BANK RECEIPT';

            // Use referenceNumber, transactionId, or payment ID as invoice number
            const invoiceNo = payment.verificationDetails?.referenceNumber ||
                payment.verificationDetails?.transactionId ||
                `PAY-${payment._id.toString().slice(-6)}`;

            ledgerEntries.push({
                _id: `payment_${payment._id}`,
                date: payment.createdAt || payment.verifiedAt || new Date(),
                vehiclesNo: payment.trip?.vehicle?.vehicleNumber || '',
                driverName: '',
                supervisor: '',
                product: '',
                particulars: particulars,
                invoiceNo: invoiceNo,
                birds: 0,
                weight: 0,
                avgWeight: 0,
                rate: 0,
                amount: payment.amount || 0,
                outstandingBalance: 0, // Will be calculated below
                trip: payment.trip ? {
                    _id: payment.trip._id,
                    tripId: payment.trip.tripId,
                    supervisor: null,
                    vehicle: null,
                    date: payment.trip.date
                } : null,
                isPayment: true // Flag to identify payment entries
            });
        });

        // Add voucher entries to ledger
        vouchers.forEach(voucher => {
            // Map voucher type to particulars:
            // Payment voucher: "RECEIPT" in admin, "PAYMENT" in customer portal
            // Receipt voucher: "PAYMENT" in admin, "RECEIPT" in customer portal
            // Store voucher type so frontend can map correctly
            const particulars = voucher.voucherType === 'Payment' ? 'RECEIPT' : voucher.voucherType === 'Receipt' ? 'PAYMENT' : 'JOURNAL';

            // For Journal Voucher entry: Find matching entry for the logged-in customer
            const entryJrVchr = voucher.entries.find(e => e.account === customerName);
            // For Journal Voucher entry: Extract non-zero amount
            const amountJrVchr = entryJrVchr
                ? (entryJrVchr.debitAmount !== 0 ? entryJrVchr.debitAmount : entryJrVchr.creditAmount)
                : 0;

            const amountTypeJrVchr = entryJrVchr
                ? (entryJrVchr.debitAmount !== 0 ? 'debit' : 'credit')
                : '';

            // Calculate amount for specific customer in Payment/Receipt vouchers
            let voucherAmount = 0;
            if (voucher.voucherType === 'Payment' || voucher.voucherType === 'Receipt') {
                const partyData = voucher.parties?.find(p => p.partyId && p.partyId.toString() === customerId.toString());
                voucherAmount = partyData ? partyData.amount : 0;
            } else if (voucher.voucherType === 'Journal') {
                voucherAmount = amountJrVchr;
            }

            ledgerEntries.push({
                _id: `voucher_${voucher._id}_${voucher.voucherType === 'Journal' ? customerForVoucher._id : voucher.parties?.find(p => p.partyId && p.partyId.toString() === customerId.toString())?.partyId}`,
                date: voucher.date,
                vehiclesNo: '',
                driverName: '',
                supervisor: '',
                product: '',
                particulars: particulars,
                voucherType: voucher.voucherType, // Store original voucher type for frontend mapping
                invoiceNo: `VCH-${voucher.voucherNumber}`,
                birds: 0,
                weight: 0,
                avgWeight: 0,
                rate: 0,
                amount: voucherAmount,
                outstandingBalance: 0, // Will be calculated below
                trip: null,
                isVoucher: true, // Flag to identify voucher entries
                amountType: amountTypeJrVchr || '',
                narration: voucher.narration || ''
            });
        });

        // Add OP BAL entry at the beginning (always first entry)
        ledgerEntries.unshift({
            _id: 'opening_balance',
            date: customer.createdAt, // Use customer creation date
            vehiclesNo: '',
            driverName: '',
            supervisor: '',
            product: '',
            particulars: 'OP BAL',
            invoiceNo: '',
            birds: 0,
            weight: 0,
            avgWeight: 0,
            rate: 0,
            amount: 0,
            outstandingBalance: customer.openingBalance || 0,
            trip: null
        });

        // Sort by date ascending (oldest first for chronological ledger)
        // But ensure OP BAL always stays first
        // Use stable sorting with secondary sort keys to prevent duplicates
        // Keep consistent chronological order (Ascending: Oldest -> Newest)
        // This is standard for ledgers so balances make sense sequentially
        ledgerEntries.sort((a, b) => {
            // OP BAL entry always comes first
            if (a._id === 'opening_balance') return -1;
            if (b._id === 'opening_balance') return 1;

            // Sort by date first
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            if (dateA !== dateB) {
                return dateA - dateB;
            }

            // Helper to extract transaction ID for grouping
            const getGroupId = (id) => {
                const strId = String(id);
                if (strId.startsWith('stock_')) return strId.split('_')[1];
                if (strId.startsWith('sale_')) return strId.split('_')[1]; // Trip sales
                if (strId.startsWith('payment_')) return strId.split('_')[1];
                if (strId.startsWith('voucher_')) return strId.split('_')[1];
                return strId;
            };

            const groupA = getGroupId(a._id);
            const groupB = getGroupId(b._id);

            // Compare Group IDs (Transaction IDs) to group transaction parts together
            if (groupA !== groupB) {
                return groupA.localeCompare(groupB);
            }

            // If Group IDs are equal (same transaction), sort by particulars order:
            // OP BAL -> SALES/STOCK_SALE/STOCK_PURCHASE -> BY CASH -> BY BANK -> DISCOUNT
            const order = {
                'OP BAL': 0,
                'SALES': 1,
                'STOCK_PURCHASE': 1,
                'STOCK_SALE': 1,
                'INDIRECT_PURCHASE': 1,
                'INDIRECT_SALES': 1,
                'RECEIPT': 1,
                'PAYMENT': 1, // Main payment entry
                'BY CASH RECEIPT': 2,
                'BY BANK RECEIPT': 3,
                'DISCOUNT': 4
            };
            const orderA = order[a.particulars] || 99;
            const orderB = order[b.particulars] || 99;
            if (orderA !== orderB) {
                return orderA - orderB;
            }

            // If still equal, sort by _id to ensure stable sort
            return String(a._id).localeCompare(String(b._id));
        });

        // Recalculate sequential balances for all entries chronologically
        // This ensures payments and sales are properly interleaved in the ledger
        let runningBalance = customer.openingBalance || 0;
        ledgerEntries.forEach((entry, index) => {
            if (entry._id === 'opening_balance') {
                // Opening balance is already set, use it as starting point
                runningBalance = entry.outstandingBalance;
                return;
            }

            // For sales entries, they already have pre-calculated balances from the sale transaction
            // But we need to recalculate to account for payments that may have been made
            // So we'll recalculate all balances sequentially

            // Update balance based on entry type and amount
            if (['SALES', 'PURCHASE', 'STOCK_SALE', 'STOCK_PURCHASE', 'INDIRECT_SALES', 'INDIRECT_PURCHASE'].includes(entry.particulars)) {
                // Add sale amount (Indirect or Direct)
                // PURCHASE tag is used for Customer View of Indirect Sale (which is a Sale from Company to Cust)
                runningBalance = runningBalance + (entry.amount || 0);
                entry.outstandingBalance = runningBalance;
            } else if (entry.particulars === 'BY CASH RECEIPT' || entry.particulars === 'BY BANK RECEIPT') {
                // Subtract payment amount (both from sales and standalone payments)
                runningBalance = Math.max(0, runningBalance - (entry.amount || 0));
                entry.outstandingBalance = runningBalance;
            } else if (entry.particulars === 'DISCOUNT') {
                // Subtract discount
                runningBalance = Math.max(0, runningBalance - (entry.amount || 0));
                entry.outstandingBalance = runningBalance;
            } else if (entry.particulars === 'RECEIPT' || entry.particulars === 'PAYMENT' || entry.particulars === 'JOURNAL') {
                // Handle voucher entries based on voucher type
                if (entry.isVoucher) {
                    if (entry.voucherType === 'Payment') {
                        // Payment voucher: customer balance increases (we pay them, so we owe them more)
                        runningBalance = runningBalance + (entry.amount || 0);
                    } else if (entry.voucherType === 'Receipt') {
                        // Receipt voucher: customer balance decreases (they pay us, so they owe us less)
                        runningBalance = Math.max(0, runningBalance - (entry.amount || 0));
                    } else if (entry.voucherType === 'Journal') {
                        if (entry.amountType === 'debit') {
                            runningBalance = runningBalance + (entry.amount || 0);
                        } else {
                            runningBalance = Math.max(0, runningBalance - (entry.amount || 0));
                        }
                    }
                } else {
                    // Receipt entries (from sales) don't change balance (amount is 0)
                }
                entry.outstandingBalance = runningBalance;
            } else if (entry.particulars === 'OP BAL') {
                // OP BAL is already set, but maintain running balance
                entry.outstandingBalance = runningBalance;
            } else {
                // For other entries, maintain current balance
                entry.outstandingBalance = runningBalance;
            }
        });

        // Keep consistent chronological order (Ascending: Oldest -> Newest)
        // This is standard for ledgers so balances make sense sequentially
        // ledgerEntries.reverse(); // REMOVED: User requested Ascending order

        // Apply pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + parseInt(limit);
        const paginatedEntries = ledgerEntries.slice(startIndex, endIndex);

        // Calculate totals
        const receiptParticulars = ['RECEIPT', 'PAYMENT', 'BY CASH RECEIPT', 'BY BANK RECEIPT'];

        const totals = {
            totalBirds: ledgerEntries.reduce((sum, entry) => sum + (entry.isIndirect || entry.isStockSale || entry.particulars === 'SALES' || entry.particulars === 'PURCHASE' ? entry.birds : 0), 0),
            totalWeight: ledgerEntries.reduce((sum, entry) => sum + entry.weight, 0),
            totalAmount: ledgerEntries.reduce((sum, entry) => sum + (['SALES', 'PURCHASE', 'STOCK_SALE', 'STOCK_PURCHASE', 'INDIRECT_SALES', 'INDIRECT_PURCHASE'].includes(entry.particulars) ? entry.amount : 0), 0),
            totalReceipt: ledgerEntries.reduce((sum, entry) => {
                if (receiptParticulars.includes(entry.particulars)) {
                    return sum + (entry.amount || 0);
                }
                return sum;
            }, 0),
            totalDiscountAndOther: ledgerEntries.reduce((sum, entry) => {
                const excludedParticulars = ['INDIRECT_PURCHASE', 'INDIRECT_SALES', 'SALES', 'PURCHASE', 'BY CASH RECEIPT', 'BY BANK RECEIPT', 'RECEIPT', 'OP BAL'];
                if (!excludedParticulars.includes(entry.particulars)) {
                    return sum + (entry.amount || 0);
                }
                return sum;
            }, 0),
            currentBalance: ledgerEntries[ledgerEntries.length - 1]?.outstandingBalance || 0 // Use the final running balance
        };

        // Self-Healing: Sync calculated ledger balance to customer profile if mismatched
        // This fixes issues where intermediate updates (like editing middle sales) might have missed propagating the final balance
        if (customer.outstandingBalance === undefined || Math.abs(customer.outstandingBalance - totals.currentBalance) > 0.01) {
            await Customer.findByIdAndUpdate(customerId, {
                outstandingBalance: totals.currentBalance,
                outstandingBalanceType: 'debit', // Ledger usually tracks the debit balance (receivable)
                updatedBy: req.user._id
            });
            console.log(`Auto-corrected customer ${customer.shopName} balance from ${customer.outstandingBalance} to ${totals.currentBalance}`);
        }

        successResponse(res, "Customer purchase ledger retrieved successfully", 200, {
            ledger: paginatedEntries,
            totals,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(ledgerEntries.length / limit),
                totalItems: ledgerEntries.length,
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (error) {
        next(error);
    }
};

export const getCustomerPayments = async (req, res, next) => {
    try {
        const { id } = req.params; // User ID
        const { page = 1, limit = 15 } = req.query;

        const customer = await Customer.findOne({ user: id, isActive: true });
        if (!customer) {
            throw new AppError('Customer profile not found', 404);
        }

        // Import Payment model
        const Payment = (await import('../models/Payment.js')).default;

        // Build query
        const query = { customer: customer._id };

        // Get payments with pagination
        const payments = await Payment.find(query)
            .populate('trip', 'tripId date')
            .populate('verifiedBy', 'name')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Payment.countDocuments(query);

        successResponse(res, "Customer payments retrieved successfully", 200, {
            payments,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalItems: total,
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (error) {
        next(error);
    }
};

export const updateCustomerPassword = async (req, res, next) => {
    try {
        const { id } = req.params; // User ID
        const { currentPassword, newPassword } = req.body;

        // Validate new password strength
        if (!validator.isStrongPassword(newPassword, {
            minLength: 6,
            minLowercase: 1,
            minUppercase: 1,
            minNumbers: 1,
            minSymbols: 0
        })) {
            throw new AppError('New password must contain at least one uppercase letter, one lowercase letter, and one number', 400);
        }

        // Find user
        const user = await User.findById(id);
        if (!user) {
            throw new AppError('User not found', 404);
        }

        // Verify current password
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
            throw new AppError('Current password is incorrect', 400);
        }

        // Hash new password
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await User.findByIdAndUpdate(id, { password: hashedNewPassword });

        successResponse(res, "Password updated successfully", 200, null);
    } catch (error) {
        next(error);
    }
};

export const getCustomerOutstandingBalance = async (req, res, next) => {
    try {
        const { id } = req.params; // User ID

        const customer = await Customer.findOne({ user: id, isActive: true });
        if (!customer) {
            throw new AppError('Customer profile not found', 404);
        }

        successResponse(res, "Customer outstanding balance retrieved successfully", 200, {
            customerId: customer._id,
            shopName: customer.shopName,
            outstandingBalance: customer.outstandingBalance || 0
        });
    } catch (error) {
        next(error);
    }
};

export const updateCustomerOutstandingBalance = async (req, res, next) => {
    try {
        const { customerId } = req.params;
        const { newOutstandingBalance, newOutstandingBalanceType } = req.body;

        if (typeof newOutstandingBalance !== 'number') {
            throw new AppError('New outstanding balance must be a number', 400);
        }

        const customer = await Customer.findById(customerId);
        if (!customer) {
            throw new AppError('Customer not found', 404);
        }

        const oldBalance = customer.outstandingBalance || 0;
        const oldBalanceType = customer.outstandingBalanceType || 'debit';
        const newBalance = Math.abs(newOutstandingBalance);
        const newBalanceType = newOutstandingBalanceType || 'debit';

        // Use findByIdAndUpdate to avoid triggering full document validation
        const updatedCustomer = await Customer.findByIdAndUpdate(
            customerId,
            {
                outstandingBalance: newBalance,
                outstandingBalanceType: newBalanceType
            },
            { new: true, runValidators: false } // Skip validators to avoid gstOrPanNumber validation
        );

        console.log(`Updated customer ${updatedCustomer.shopName} outstanding balance from ${oldBalance} ${oldBalanceType} to ${newBalance} ${newBalanceType}`);

        successResponse(res, "Customer outstanding balance updated successfully", 200, {
            customerId: updatedCustomer._id,
            shopName: updatedCustomer.shopName,
            oldBalance,
            oldBalanceType,
            newBalance: newBalance
        });
    } catch (error) {
        next(error);
    }
};