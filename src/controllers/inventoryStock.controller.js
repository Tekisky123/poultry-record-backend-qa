import InventoryStock from "../models/InventoryStock.js";
import Vendor from "../models/Vendor.js";
import Customer from "../models/Customer.js";
import Ledger from "../models/Ledger.js";
import Group from "../models/Group.js";
import Trip from "../models/Trip.js";
import AppError from "../utils/AppError.js";
import { successResponse } from "../utils/responseHandler.js";
import { addToBalance, subtractFromBalance, toSignedValue, fromSignedValue } from "../utils/balanceUtils.js";

// Add Purchase to Inventory
export const addPurchase = async (req, res, next) => {
    try {
        const type = req.body.inventoryType || "bird";
        const purchaseData = {
            ...req.body,
            type: req.body.type || "purchase", // Allow override for 'opening' stock
            inventoryType: type, // Default to bird for now, can be dynamic later
            supervisorId: req.user._id,
            date: req.body.date || new Date(),
            birds: type === 'feed' ? 0 : (req.body.birds || 0)
        };

        // Basic validation
        if (type === 'bird') {
            if (!purchaseData.birds || !purchaseData.weight || !purchaseData.rate) {
                throw new AppError("Birds, Weight, and Rate are required", 400);
            }
        } else {
            // Feed or other types
            if (!purchaseData.weight || !purchaseData.rate) {
                throw new AppError("Weight/Quantity and Rate are required", 400);
            }
        }

        // --- Vendor Balance Update Logic ---
        if (purchaseData.vendorId) {
            const vendor = await Vendor.findById(purchaseData.vendorId);
            if (vendor) {
                // A purchase increases the amount we owe to the vendor (Credit)
                // Using addToBalance with transactionType 'credit'
                const newBalance = addToBalance(
                    vendor.outstandingBalance || 0,
                    vendor.outstandingBalanceType || 'credit',
                    Number(purchaseData.amount),
                    'credit'
                );

                vendor.outstandingBalance = newBalance.amount;
                vendor.outstandingBalanceType = newBalance.type;
                vendor.updatedBy = req.user._id;
                await vendor.save();
            }
        }
        // -----------------------------------

        const stock = new InventoryStock(purchaseData);
        await stock.save();

        const populatedStock = await InventoryStock.findById(stock._id)
            .populate("vendorId", "vendorName")
            .populate("vehicleId", "vehicleNumber")
            .populate("supervisorId", "name");

        successResponse(res, "Stock purchase added successfully", 201, populatedStock);
    } catch (error) {
        next(error);
    }
};

// Add Mortality to Inventory
export const addMortality = async (req, res, next) => {
    try {
        const mortalityData = {
            ...req.body,
            type: "mortality",
            inventoryType: "bird",
            supervisorId: req.user._id,
            date: req.body.date || new Date()
        };

        // Basic validation
        if (!mortalityData.birds || !mortalityData.weight || !mortalityData.rate) {
            throw new AppError("Birds, Weight, and Rate are required", 400);
        }

        // Mortality doesn't usually affect Customer/Vendor ledger directly unless specified.
        // It's an internal loss. So we just save the stock record.

        const stock = new InventoryStock(mortalityData);
        await stock.save();

        successResponse(res, "Mortality added successfully", 201, stock);
    } catch (error) {
        next(error);
    }
};

// Add Weight Loss (or Weight ON) to Inventory
export const addWeightLoss = async (req, res, next) => {
    try {
        const weightLossData = {
            ...req.body,
            type: "weight_loss",
            inventoryType: "bird",
            supervisorId: req.user._id,
            date: req.body.date || new Date(),
            birds: 0 // Always 0 for weight loss/gain
        };

        // Basic validation
        // Weight can be negative or positive. Rate is required.
        if (weightLossData.weight === undefined || weightLossData.rate === undefined) {
            throw new AppError("Weight and Rate are required", 400);
        }

        const stock = new InventoryStock(weightLossData);
        await stock.save();

        successResponse(res, "Weight Loss/Gain added successfully", 201, stock);
    } catch (error) {
        next(error);
    }
};

// Add Consume (Feed or other)
export const addConsume = async (req, res, next) => {
    try {
        const consumeData = {
            ...req.body,
            type: "consume",
            inventoryType: req.body.inventoryType || "feed", // Default to feed
            supervisorId: req.user._id,
            date: req.body.date || new Date(),
            birds: 0 // Usually 0 for feed consume
        };

        // Basic validation
        if (!consumeData.weight || !consumeData.rate) {
            throw new AppError("Quantity (Weight) and Rate are required", 400);
        }

        // Auto calculate amount if not provided (though frontend sends it)
        if (!consumeData.amount) {
            consumeData.amount = Number(consumeData.weight) * Number(consumeData.rate);
        }

        // 1. Find or Create "FEED CONSUME" Ledger
        let ledger = await Ledger.findOne({ name: { $regex: /^feed consume$/i } });
        if (!ledger) {
            // Find a suitable group
            let group = await Group.findOne({ slug: 'direct-expenses' });
            if (!group) group = await Group.findOne({ slug: 'expenses' }); // Fallback
            if (!group) group = await Group.findOne({ name: { $regex: /expense/i } });

            if (group) {
                ledger = await Ledger.create({
                    name: 'FEED CONSUME',
                    group: group._id,
                    ledgerType: 'general',
                    openingBalance: 0,
                    openingBalanceType: 'debit',
                    outstandingBalance: 0,
                    outstandingBalanceType: 'debit',
                    createdBy: req.user._id,
                    updatedBy: req.user._id
                });
            } else {
                console.warn("Could not find Expense group to create FEED CONSUME ledger");
            }
        }

        if (ledger) {
            consumeData.expenseLedgerId = ledger._id;
        }

        const stock = new InventoryStock(consumeData);
        await stock.save();

        // 2. Update Ledger Balance (Debit)
        if (ledger) {
            const newBalance = addToBalance(
                ledger.outstandingBalance,
                ledger.outstandingBalanceType,
                stock.amount,
                'debit'
            );
            ledger.outstandingBalance = newBalance.amount;
            ledger.outstandingBalanceType = newBalance.type;
            await ledger.save();
        }

        successResponse(res, "Consumption added successfully", 201, stock);
    } catch (error) {
        next(error);
    }
};

// Add Sale (with Ledger updates)
export const addSale = async (req, res, next) => {
    try {
        let saleData = req.body;

        saleData = {
            ...saleData,
            type: "sale",
            inventoryType: "bird",
            supervisorId: req.user._id,
            date: saleData.date || new Date(),
            amount: Number(saleData.amount),
        };

        // Check stock availability (Simple check - can be improved)
        // Need to calculate current stock? For now, we trust the input validation on frontend 
        // or we need a way to track global available stock. 
        // Since "Add to Stock" adds to global stock, we should ideally check limit.
        // Leaving stock limit check for now to focus on ledger logic.

        // Clean up optional fields
        if (!saleData.cashLedgerId || saleData.cashLedgerId === '') delete saleData.cashLedgerId;
        if (!saleData.onlineLedgerId || saleData.onlineLedgerId === '') delete saleData.onlineLedgerId;
        if (!saleData.customerId || saleData.customerId === '') delete saleData.customerId;

        // Customer Balance Update Logic (Copied from trip.controller.js)
        if (saleData.customerId) {
            try {
                const customer = await Customer.findById(saleData.customerId);
                if (customer) {
                    const customerBalanceSigned = toSignedValue(
                        customer.outstandingBalance || 0,
                        customer.outstandingBalanceType || 'debit'
                    );

                    const globalOutstandingBalance = customerBalanceSigned;
                    const totalPaid = (Number(saleData.onlinePaid) || 0) + (Number(saleData.cashPaid) || 0);
                    const discount = Number(saleData.discount) || 0;
                    const amount = Number(saleData.amount) || 0;

                    let finalBalanceSigned = globalOutstandingBalance;
                    if (amount > 0) finalBalanceSigned += amount;
                    if (totalPaid > 0) finalBalanceSigned -= totalPaid;
                    if (discount > 0) finalBalanceSigned -= discount;

                    const finalBalanceObj = fromSignedValue(finalBalanceSigned);

                    saleData.balance = Number(finalBalanceObj.amount.toFixed(2));

                    // Update customer
                    customer.outstandingBalance = finalBalanceObj.amount;
                    customer.outstandingBalanceType = finalBalanceObj.type;
                    customer.updatedBy = req.user._id;
                    await customer.save();
                }
            } catch (error) {
                console.error('Error calculating sale balance:', error);
            }
        }

        const stock = new InventoryStock(saleData);
        await stock.save();

        // Update Ledgers
        const cashPaidAmount = Number(saleData.cashPaid) || 0;
        if (cashPaidAmount > 0) {
            try {
                let cashLedger;
                if (saleData.cashLedgerId) {
                    cashLedger = await Ledger.findById(saleData.cashLedgerId);
                } else {
                    // Find default CASH ledger (case insensitive check on name 'Cash')
                    // Assuming there's a ledger named 'Cash' or similar. 
                    // Better to find by Group type 'Cash Operations' if structure supported, but Name 'Cash' is common convention or based on User Request "CASH A/C".
                    // Find default CASH ledger (case insensitive check on name 'Cash' or 'Cash A/C')
                    cashLedger = await Ledger.findOne({ name: { $regex: /^(cash|cash\s+a\/c)$/i } });

                    // Fallback to finding via group?
                    if (!cashLedger) {
                        const cashGroup = await Group.findOne({ name: { $regex: /cash/i } });
                        if (cashGroup) {
                            cashLedger = await Ledger.findOne({ group: cashGroup._id });
                        }
                    }
                }

                if (cashLedger) {
                    const newBalance = addToBalance(
                        Number(cashLedger.outstandingBalance) || 0,
                        cashLedger.outstandingBalanceType || 'debit',
                        cashPaidAmount,
                        'debit'
                    );
                    cashLedger.outstandingBalance = newBalance.amount;
                    cashLedger.outstandingBalanceType = newBalance.type;
                    cashLedger.updatedBy = req.user._id;
                    await cashLedger.save();

                    // Update the stock record with the actual ledger ID used
                    stock.cashLedgerId = cashLedger._id;
                    await stock.save();
                } else {
                    console.warn("No 'Cash' ledger found to update.");
                }
            } catch (err) {
                console.error("Cash ledger update failed", err);
            }
        }

        const onlinePaidAmount = Number(saleData.onlinePaid) || 0;
        if (saleData.onlineLedgerId && onlinePaidAmount > 0) {
            try {
                const onlineLedger = await Ledger.findById(saleData.onlineLedgerId);
                if (onlineLedger) {
                    const newBalance = addToBalance(
                        Number(onlineLedger.outstandingBalance) || 0,
                        onlineLedger.outstandingBalanceType || 'debit',
                        onlinePaidAmount,
                        'debit'
                    );
                    onlineLedger.outstandingBalance = newBalance.amount;
                    onlineLedger.outstandingBalanceType = newBalance.type;
                    onlineLedger.updatedBy = req.user._id;
                    await onlineLedger.save();
                }
            } catch (err) {
                console.error("Online ledger update failed", err);
            }
        }

        const populatedStock = await InventoryStock.findById(stock._id)
            .populate("customerId", "shopName ownerName")
            .populate("supervisorId", "name");

        successResponse(res, "Sale added successfully", 201, populatedStock);
    } catch (error) {
        next(error);
    }
};

// Add Receipt
export const addReceipt = async (req, res, next) => {
    try {
        let receiptData = req.body;

        receiptData = {
            ...receiptData,
            type: "receipt",
            inventoryType: "bird", // Not strictly inventory, but tracking payment
            supervisorId: req.user._id,
            date: receiptData.date || new Date(),
            birds: 0,
            weight: 0,
            rate: 0,
            amount: 0
        };

        if (!receiptData.cashLedgerId || receiptData.cashLedgerId === '') delete receiptData.cashLedgerId;
        if (!receiptData.onlineLedgerId || receiptData.onlineLedgerId === '') delete receiptData.onlineLedgerId;
        if (!receiptData.customerId || receiptData.customerId === '') delete receiptData.customerId;

        // Customer Balance Update (Receipt reduces debt)
        if (receiptData.customerId) {
            try {
                const customer = await Customer.findById(receiptData.customerId);
                if (customer) {
                    const customerBalanceSigned = toSignedValue(
                        customer.outstandingBalance || 0,
                        customer.outstandingBalanceType || 'debit'
                    );

                    const totalPaid = (Number(receiptData.onlinePaid) || 0) + (Number(receiptData.cashPaid) || 0);
                    const discount = Number(receiptData.discount) || 0;

                    let finalBalanceSigned = customerBalanceSigned;
                    if (totalPaid > 0) finalBalanceSigned -= totalPaid;
                    if (discount > 0) finalBalanceSigned -= discount;

                    const finalBalanceObj = fromSignedValue(finalBalanceSigned);

                    receiptData.balance = Number(finalBalanceObj.amount.toFixed(2));

                    customer.outstandingBalance = finalBalanceObj.amount;
                    customer.outstandingBalanceType = finalBalanceObj.type;
                    customer.updatedBy = req.user._id;
                    await customer.save();
                }
            } catch (error) {
                console.error('Error calculating receipt balance:', error);
            }
        }

        const stock = new InventoryStock(receiptData);
        await stock.save();

        // Update Ledgers (Receipt = Money In = Debit to Cash/Bank Ledger)
        const cashPaidAmount = Number(receiptData.cashPaid) || 0;
        if (cashPaidAmount > 0) {
            try {
                let cashLedger;
                if (receiptData.cashLedgerId) {
                    cashLedger = await Ledger.findById(receiptData.cashLedgerId);
                } else {
                    // Find default CASH ledger (case insensitive check on name 'Cash' or 'CASH A/C')
                    cashLedger = await Ledger.findOne({ name: { $regex: /^(cash|cash\s+a\/c)$/i } });

                    // Fallback to finding via group?
                    if (!cashLedger) {
                        const cashGroup = await Group.findOne({ name: { $regex: /cash/i } });
                        if (cashGroup) {
                            cashLedger = await Ledger.findOne({ group: cashGroup._id });
                        }
                    }
                }

                if (cashLedger) {
                    const newBalance = addToBalance(
                        Number(cashLedger.outstandingBalance) || 0,
                        cashLedger.outstandingBalanceType || 'debit',
                        cashPaidAmount,
                        'debit'
                    );
                    cashLedger.outstandingBalance = newBalance.amount;
                    cashLedger.outstandingBalanceType = newBalance.type;
                    cashLedger.updatedBy = req.user._id;
                    await cashLedger.save();

                    // Update the stock record with the actual ledger ID used
                    stock.cashLedgerId = cashLedger._id;
                    await stock.save();
                } else {
                    console.warn("No 'Cash' ledger found to update.");
                }
            } catch (err) {
                console.error("Cash ledger update failed", err);
            }
        }

        const onlinePaidAmount = Number(receiptData.onlinePaid) || 0;
        if (receiptData.onlineLedgerId && onlinePaidAmount > 0) {
            const onlineLedger = await Ledger.findById(receiptData.onlineLedgerId);
            if (onlineLedger) {
                const newBalance = addToBalance(Number(onlineLedger.outstandingBalance), onlineLedger.outstandingBalanceType, onlinePaidAmount, 'debit');
                onlineLedger.outstandingBalance = newBalance.amount;
                onlineLedger.outstandingBalanceType = newBalance.type;
                await onlineLedger.save();
            }
        }

        successResponse(res, "Receipt added successfully", 201, stock);

    } catch (error) {
        next(error);
    }
};

// Get All Stocks (Includes Trip Stocks)
export const getStocks = async (req, res, next) => {
    try {
        const { startDate, endDate, supervisor, type } = req.query;

        let query = {};
        if (supervisor) query.supervisorId = supervisor;
        if (type) query.type = type;
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        // 1. Fetch InventoryStock
        const inventoryStocks = await InventoryStock.find(query)
            .populate("vendorId", "vendorName companyName name")
            .populate("customerId", "shopName ownerName")
            .populate("vehicleId", "vehicleNumber")
            .populate("supervisorId", "name")
            .lean();

        // 2. Fetch Trip Stocks if type is 'purchase' or undefined (showing all)
        let tripStocks = [];
        if (!type || type === 'purchase') {
            let tripQuery = {};
            // Filter trips by date if needed (Note: stock.addedAt is what matters, but trip.createdAt is approximate)
            // Ideally we filter after unrolling.

            const trips = await Trip.find({
                ...tripQuery,
                stocks: { $exists: true, $not: { $size: 0 } }
            })
                .select('tripId stocks supervisor vehicle')
                .populate('supervisor', 'name')
                .populate('vehicle', 'vehicleNumber')
                .lean();

            // Flatten trip stocks
            tripStocks = trips.flatMap(trip =>
                trip.stocks.map(s => ({
                    _id: s._id, // Use stock ID from subdocument
                    source: 'trip', // Marker
                    tripId: trip._id,
                    tripIdDisplay: trip.tripId,
                    inventoryType: 'bird',
                    type: 'purchase', // Trip stock addition counts as purchase for Global Stock
                    birds: s.birds,
                    weight: s.weight,
                    avgWeight: s.avgWeight,
                    rate: s.rate,
                    amount: s.value,
                    date: s.addedAt,
                    supervisorId: trip.supervisor,
                    vehicleId: trip.vehicle,
                    vendorId: { vendorName: "Trip-Stock (" + (trip.vehicle?.vehicleNumber || 'Unassigned') + ")" }, // Fake vendor
                    notes: s.notes
                }))
            );

            // Filter flattened trip stocks by params
            if (supervisor) {
                tripStocks = tripStocks.filter(s => s.supervisorId?._id?.toString() === supervisor);
            }
            if (startDate) {
                tripStocks = tripStocks.filter(s => new Date(s.date) >= new Date(startDate));
            }
            if (endDate) {
                tripStocks = tripStocks.filter(s => new Date(s.date) <= new Date(endDate));
            }
        }

        // Combine and Sort
        const allStocks = [...inventoryStocks, ...tripStocks].sort((a, b) => new Date(b.date) - new Date(a.date));

        successResponse(res, "Stocks fetched successfully", 200, allStocks);
    } catch (error) {
        next(error);
    }
};

// Update Stock (Handles Purchases, Sales, and Receipts)
export const updateStock = async (req, res, next) => {
    const { id } = req.params;
    try {
        const updates = req.body;

        // 1. Fetch existing stock
        const oldStock = await InventoryStock.findById(id);
        if (!oldStock) {
            return res.status(404).json({ message: "Stock record not found" });
        }

        const type = oldStock.type;

        // ---------------------------------------------------------
        // PURCHASE UPDATE LOGIC (Vendor)
        // ---------------------------------------------------------
        if (type === 'purchase' || type === 'opening') {
            const newAmount = Number(updates.amount);
            const oldAmount = Number(oldStock.amount);

            const oldVendorId = oldStock.vendorId?.toString();
            const newVendorId = updates.vendorId?.toString();

            const isVendorChanged = newVendorId && newVendorId !== oldVendorId;
            const isAmountChanged = newAmount !== oldAmount;

            if (isVendorChanged || isAmountChanged) {
                // A. Revert Old Vendor Balance
                if (oldVendorId) {
                    const oldVendor = await Vendor.findById(oldVendorId);
                    if (oldVendor) {
                        const revertedBalance = addToBalance(
                            oldVendor.outstandingBalance || 0,
                            oldVendor.outstandingBalanceType || 'credit',
                            oldAmount,
                            'debit'
                        );
                        oldVendor.outstandingBalance = revertedBalance.amount;
                        oldVendor.outstandingBalanceType = revertedBalance.type;
                        await oldVendor.save();
                    }
                }

                // B. Apply New Vendor Balance
                if (newVendorId) {
                    const newVendor = await Vendor.findById(newVendorId);
                    if (newVendor) {
                        const updatedBalance = addToBalance(
                            newVendor.outstandingBalance || 0,
                            newVendor.outstandingBalanceType || 'credit',
                            newAmount,
                            'credit'
                        );
                        newVendor.outstandingBalance = updatedBalance.amount;
                        newVendor.outstandingBalanceType = updatedBalance.type;
                        await newVendor.save();
                    }
                }
            }
        }

        // ---------------------------------------------------------
        // SALE & RECEIPT UPDATE LOGIC (Customer & Ledgers)
        // ---------------------------------------------------------
        if (type === 'sale' || type === 'receipt') {
            const isSale = type === 'sale';

            // --- 1. Customer Balance Update ---
            // Revert Old Customer Balance
            const oldCustomerId = oldStock.customerId?.toString();
            // Calculate old net impact on Customer Balance
            // Sale: +Amount -Paid -Discount
            // Receipt: -Paid -Discount
            let oldImpact = 0;
            if (isSale) oldImpact += (Number(oldStock.amount) || 0);
            oldImpact -= ((Number(oldStock.cashPaid) || 0) + (Number(oldStock.onlinePaid) || 0) + (Number(oldStock.discount) || 0));

            if (oldCustomerId) {
                const oldCustomer = await Customer.findById(oldCustomerId);
                if (oldCustomer) {
                    // To revert, subtract the old impact
                    // If impact was positive (increased debt), we subtract it.
                    // If impact was negative (decreased debt), subtracting a negative adds it back.
                    const revertedBalance = addToBalance(
                        oldCustomer.outstandingBalance || 0,
                        oldCustomer.outstandingBalanceType || 'debit',
                        Math.abs(oldImpact), // Amount
                        oldImpact > 0 ? 'credit' : 'debit' // Type: Opposite of impact
                    );
                    oldCustomer.outstandingBalance = revertedBalance.amount;
                    oldCustomer.outstandingBalanceType = revertedBalance.type;
                    await oldCustomer.save();
                }
            }

            // Apply New Customer Balance
            const newCustomerId = updates.customerId?.toString() || oldCustomerId; // Use old if not updated
            let newImpact = 0;
            const newAmount = isSale ? (Number(updates.amount) !== undefined ? Number(updates.amount) : Number(oldStock.amount)) : 0;
            const newCashPaid = Number(updates.cashPaid) !== undefined ? Number(updates.cashPaid) : Number(oldStock.cashPaid);
            const newOnlinePaid = Number(updates.onlinePaid) !== undefined ? Number(updates.onlinePaid) : Number(oldStock.onlinePaid);
            const newDiscount = Number(updates.discount) !== undefined ? Number(updates.discount) : Number(oldStock.discount);

            if (isSale) newImpact += newAmount;
            newImpact -= (newCashPaid + newOnlinePaid + newDiscount);

            if (newCustomerId) {
                const newCustomer = await Customer.findById(newCustomerId);
                if (newCustomer) {
                    const updatedBalance = addToBalance(
                        newCustomer.outstandingBalance || 0,
                        newCustomer.outstandingBalanceType || 'debit',
                        Math.abs(newImpact),
                        newImpact > 0 ? 'debit' : 'credit' // Type: Same as impact
                    );
                    newCustomer.outstandingBalance = updatedBalance.amount;
                    newCustomer.outstandingBalanceType = updatedBalance.type;
                    await newCustomer.save();
                }
            }

            // --- 2. Ledger Update (Cash) ---
            const oldCashLedgerId = oldStock.cashLedgerId?.toString();
            const newCashLedgerId = updates.cashLedgerId ? updates.cashLedgerId.toString() : oldCashLedgerId;
            const oldCashPaid = Number(oldStock.cashPaid) || 0;
            const updatedCashPaid = Number(updates.cashPaid) !== undefined ? Number(updates.cashPaid) : oldCashPaid;

            // Revert Old Cash
            if (oldCashLedgerId && oldCashPaid > 0) {
                const oldCashLedger = await Ledger.findById(oldCashLedgerId);
                if (oldCashLedger) {
                    // Receipt/Sale into Cash = Debit. Revert = Credit.
                    const reverted = addToBalance(oldCashLedger.outstandingBalance, oldCashLedger.outstandingBalanceType, oldCashPaid, 'credit');
                    oldCashLedger.outstandingBalance = reverted.amount;
                    oldCashLedger.outstandingBalanceType = reverted.type;
                    await oldCashLedger.save();
                }
            }
            // Apply New Cash
            if (newCashLedgerId && updatedCashPaid > 0) {
                const newCashLedger = await Ledger.findById(newCashLedgerId);
                if (newCashLedger) {
                    // Sale/Receipt into Cash = Debit
                    const updated = addToBalance(newCashLedger.outstandingBalance, newCashLedger.outstandingBalanceType, updatedCashPaid, 'debit');
                    newCashLedger.outstandingBalance = updated.amount;
                    newCashLedger.outstandingBalanceType = updated.type;
                    await newCashLedger.save();
                }
            }

            // --- 3. Ledger Update (Online) ---
            const oldOnlineLedgerId = oldStock.onlineLedgerId?.toString();
            const newOnlineLedgerId = updates.onlineLedgerId ? updates.onlineLedgerId.toString() : oldOnlineLedgerId;
            const oldOnlinePaid = Number(oldStock.onlinePaid) || 0;
            const updatedOnlinePaid = Number(updates.onlinePaid) !== undefined ? Number(updates.onlinePaid) : oldOnlinePaid;

            // Revert Old Online
            if (oldOnlineLedgerId && oldOnlinePaid > 0) {
                const oldOnlineLedger = await Ledger.findById(oldOnlineLedgerId);
                if (oldOnlineLedger) {
                    const reverted = addToBalance(oldOnlineLedger.outstandingBalance, oldOnlineLedger.outstandingBalanceType, oldOnlinePaid, 'credit');
                    oldOnlineLedger.outstandingBalance = reverted.amount;
                    oldOnlineLedger.outstandingBalanceType = reverted.type;
                    await oldOnlineLedger.save();
                }
            }
            // Apply New Online
            if (newOnlineLedgerId && updatedOnlinePaid > 0) {
                const newOnlineLedger = await Ledger.findById(newOnlineLedgerId);
                if (newOnlineLedger) {
                    const updated = addToBalance(newOnlineLedger.outstandingBalance, newOnlineLedger.outstandingBalanceType, updatedOnlinePaid, 'debit');
                    newOnlineLedger.outstandingBalance = updated.amount;
                    newOnlineLedger.outstandingBalanceType = updated.type;
                    await newOnlineLedger.save();
                }
            }
        }

        // ---------------------------------------------------------
        // CONSUME UPDATE LOGIC (Feed Consume)
        // ---------------------------------------------------------
        if (type === 'consume') {
            const oldAmount = Number(oldStock.amount) || 0;
            const newAmount = updates.amount !== undefined ? Number(updates.amount) : oldAmount;

            const oldLedgerId = oldStock.expenseLedgerId?.toString();
            // Assuming frontend might not send expenseLedgerId on update if it's hidden, so use old one if not provided
            // Or better, we always want to target the same ledger unless we support moving ledgers.
            // For now, assume ledger doesn't change unless we specifically want to support it. 
            // If we did want to support ledger change, we'd look for updates.expenseLedgerId.
            const targetLedgerId = oldLedgerId; // Simplify: user can't change ledger in frontend

            if (targetLedgerId && newAmount !== oldAmount) {
                const ledger = await Ledger.findById(targetLedgerId);
                if (ledger) {
                    // Revert Old (Credit)
                    // Apply New (Debit)
                    // Net difference: (New - Old) -> Add to Balance (Debit)
                    // If New > Old, expense increases (Debit increases)
                    // If New < Old, expense decreases (Debit decreases -> Credit)

                    // Let's use clean Revert/Apply pattern
                    const reverted = addToBalance(ledger.outstandingBalance, ledger.outstandingBalanceType, oldAmount, 'credit');
                    const reapplied = addToBalance(reverted.amount, reverted.type, newAmount, 'debit');

                    ledger.outstandingBalance = reapplied.amount;
                    ledger.outstandingBalanceType = reapplied.type;
                    await ledger.save();
                }
            }
        }

        // 4. Update Stock Record
        const updatedStock = await InventoryStock.findByIdAndUpdate(id, {
            ...updates,
            updatedBy: req.user._id
        }, { new: true })
            .populate("vendorId", "vendorName")
            .populate("customerId", "shopName ownerName")
            .populate("vehicleId", "vehicleNumber")
            .populate("supervisorId", "name");

        successResponse(res, "Stock updated successfully", 200, updatedStock);

    } catch (error) {
        next(error);
    }
};

// Get Monthly Stock Stats
export const getMonthlyStockStats = async (req, res, next) => {
    try {
        const { year } = req.query;
        const currentYear = year ? parseInt(year) : new Date().getFullYear();

        // Month names helper
        const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];

        const pipeline = [
            {
                $match: {
                    date: {
                        $gte: new Date(`${currentYear}-01-01`),
                        $lte: new Date(`${currentYear}-12-31`)
                    }
                }
            },
            {
                $group: {
                    _id: { $month: "$date" },
                    // Purchase
                    totalPurchaseAmount: {
                        $sum: {
                            $cond: [{ $in: ["$type", ["purchase", "opening"]] }, "$amount", 0]
                        }
                    },
                    totalPurchaseBirds: {
                        $sum: {
                            $cond: [{ $and: [{ $in: ["$type", ["purchase", "opening"]] }, { $eq: ["$inventoryType", "bird"] }] }, "$birds", 0]
                        }
                    },
                    // Sale
                    totalSaleAmount: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "sale"] }, "$amount", 0]
                        }
                    },
                    totalSaleBirds: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "sale"] }, "$birds", 0]
                        }
                    },
                    // Mortality
                    totalMortalityBirds: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "mortality"] }, "$birds", 0]
                        }
                    },
                    // Feed Consume
                    totalFeedConsumeAmount: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "consume"] }, "$amount", 0]
                        }
                    }
                }
            },
            { $sort: { _id: 1 } }
        ];

        const results = await InventoryStock.aggregate(pipeline);

        // Format for frontend
        const months = Array.from({ length: 12 }, (_, i) => {
            const data = results.find(r => r._id === i + 1);
            return {
                month: i + 1,
                name: monthNames[i],
                purchaseAmount: data ? data.totalPurchaseAmount : 0,
                saleAmount: data ? data.totalSaleAmount : 0,
                mortalityBirds: data ? data.totalMortalityBirds : 0,
                feedConsumeAmount: data ? data.totalFeedConsumeAmount : 0,
            };
        });

        // Calculate Totals
        const totals = months.reduce((acc, curr) => ({
            purchaseAmount: acc.purchaseAmount + curr.purchaseAmount,
            saleAmount: acc.saleAmount + curr.saleAmount,
            mortalityBirds: acc.mortalityBirds + curr.mortalityBirds,
            feedConsumeAmount: acc.feedConsumeAmount + curr.feedConsumeAmount
        }), { purchaseAmount: 0, saleAmount: 0, mortalityBirds: 0, feedConsumeAmount: 0 });

        successResponse(res, "Monthly stock stats fetched", 200, { months, year: currentYear, totals });
    } catch (error) {
        next(error);
    }
};

// Get Daily Stock Stats (for a month)
export const getDailyStockStats = async (req, res, next) => {
    try {
        const { year, month } = req.query;
        if (!year || !month) throw new AppError("Year and Month are required", 400);

        const startDate = new Date(Date.UTC(year, month - 1, 1));
        const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59)); // Last day of month

        const pipeline = [
            {
                $match: {
                    date: {
                        $gte: startDate,
                        $lte: endDate
                    }
                }
            },
            {
                $group: {
                    _id: { $dayOfMonth: "$date" },
                    date: { $first: "$date" },
                    // Purchase
                    totalPurchaseAmount: {
                        $sum: {
                            $cond: [{ $in: ["$type", ["purchase", "opening"]] }, "$amount", 0]
                        }
                    },
                    totalPurchaseBirds: {
                        $sum: {
                            $cond: [{ $and: [{ $in: ["$type", ["purchase", "opening"]] }, { $eq: ["$inventoryType", "bird"] }] }, "$birds", 0]
                        }
                    },
                    // Sale
                    totalSaleAmount: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "sale"] }, "$amount", 0]
                        }
                    },
                    totalSaleBirds: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "sale"] }, "$birds", 0]
                        }
                    },
                    // Mortality
                    totalMortalityBirds: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "mortality"] }, "$birds", 0]
                        }
                    },
                    // Feed Consume
                    totalFeedConsumeAmount: {
                        $sum: {
                            $cond: [{ $eq: ["$type", "consume"] }, "$amount", 0]
                        }
                    }
                }
            },
            { $sort: { _id: -1 } } // Descending date
        ];

        const results = await InventoryStock.aggregate(pipeline);

        // Add formatted date string
        const formattedResults = results.map(r => ({
            ...r,
            day: r._id,
            formattedDate: new Date(r.date).toISOString().split('T')[0]
        }));

        const totals = formattedResults.reduce((acc, curr) => ({
            totalPurchaseAmount: acc.totalPurchaseAmount + curr.totalPurchaseAmount,
            totalSaleAmount: acc.totalSaleAmount + curr.totalSaleAmount,
            totalMortalityBirds: acc.totalMortalityBirds + curr.totalMortalityBirds,
            totalFeedConsumeAmount: acc.totalFeedConsumeAmount + curr.totalFeedConsumeAmount
        }), { totalPurchaseAmount: 0, totalSaleAmount: 0, totalMortalityBirds: 0, totalFeedConsumeAmount: 0 });

        successResponse(res, "Daily stock stats fetched", 200, { days: formattedResults, totals });

    } catch (error) {
        next(error);
    }
};

// Delete Stock
export const deleteStock = async (req, res, next) => {
    // TODO: Implement delete logic reversing balances
    next(new AppError("Delete not implemented yet", 501));
};
