import Vendor from "../models/Vendor.js";
import Group from "../models/Group.js";
import Trip from "../models/Trip.js";
import Voucher from "../models/Voucher.js";
import IndirectSale from "../models/IndirectSale.js";
import InventoryStock from "../models/InventoryStock.js";
import { successResponse } from "../utils/responseHandler.js";
import AppError from "../utils/AppError.js";


import { syncOutstandingBalance } from "../utils/balanceUtils.js";

export const addVendor = async (req, res, next) => {
    try {
        const { group, ...vendorData } = req.body;

        // Automatically find and assign "Sundry Creditors" group for vendors
        let groupId = group;
        if (!groupId) {
            const sundryCreditorsGroup = await Group.findOne({
                slug: 'sundry-creditors',
                isActive: true
            });
            if (!sundryCreditorsGroup) {
                // Try fallback by name
                const fallbackGroup = await Group.findOne({ name: 'Sundry Creditors', isActive: true });
                if (!fallbackGroup) {
                    throw new AppError('Sundry Creditors group not found (slug: sundry-creditors). Please contact administrator.', 404);
                }
                groupId = fallbackGroup._id;
            } else {
                groupId = sundryCreditorsGroup._id;
            }
        } else {
            // Validate provided group exists
            const groupDoc = await Group.findById(groupId);
            if (!groupDoc || !groupDoc.isActive) {
                throw new AppError('Group not found or inactive', 404);
            }
        }

        const vendor = new Vendor({
            ...vendorData,
            group: groupId, // Use automatically assigned or provided group
            createdBy: req.user._id,
            updatedBy: req.user._id,
            // Initialize outstanding balance same as opening balance
            outstandingBalance: vendorData.openingBalance || 0,
            outstandingBalanceType: vendorData.openingBalanceType || 'credit'
        });
        await vendor.save();

        const populatedVendor = await Vendor.findById(vendor._id)
            .populate('group', 'name type slug');

        successResponse(res, "New vendor added", 201, populatedVendor)
    } catch (error) {
        next(error);
    }
};

export const getVendors = async (req, res, next) => {
    try {
        const vendors = await Vendor.find({ isActive: true })
            .populate('group', 'name type slug')
            .sort({ vendorName: 1 });
        successResponse(res, "vendors", 200, vendors)
    } catch (error) {
        next(error);
    }
};

export const getVendorById = async (req, res, next) => {
    const { id } = req?.params;
    try {
        const vendor = await Vendor.findOne({ _id: id, isActive: true })
            .populate('group', 'name type slug');
        successResponse(res, "vendor", 200, vendor)
    } catch (error) {
        next(error);
    }
};

export const updateVendor = async (req, res, next) => {
    const { id } = req?.params;
    try {
        const { group, ...vendorData } = req.body;

        // Automatically set group to "Sundry Creditors" if not provided
        let groupId = group;
        if (!groupId) {
            const sundryCreditorsGroup = await Group.findOne({
                slug: 'sundry-creditors',
                isActive: true
            });
            if (!sundryCreditorsGroup) {
                // Try fallback by name
                const fallbackGroup = await Group.findOne({ name: 'Sundry Creditors', isActive: true });
                if (!fallbackGroup) {
                    throw new AppError('Sundry Creditors group not found (slug: sundry-creditors). Please contact administrator.', 404);
                }
                groupId = fallbackGroup._id;
            } else {
                groupId = sundryCreditorsGroup._id;
            }
        } else {
            // Validate provided group exists
            const groupDoc = await Group.findById(groupId);
            if (!groupDoc || !groupDoc.isActive) {
                throw new AppError('Group not found or inactive', 404);
            }
        }

        const updateData = {
            ...vendorData,
            group: groupId, // Use automatically assigned or provided group
            updatedBy: req.user._id
        };

        // Handle opening balance update with sync logic
        const existingVendor = await Vendor.findById(id);
        if (!existingVendor) {
            return res.status(404).json({ message: "Vendor not found" });
        }

        // Check if TDS field is updated
        if (vendorData.tdsApplicable !== undefined && vendorData.tdsApplicable !== existingVendor.tdsApplicable) {
            updateData.tdsUpdatedAt = new Date();
        }

        const isOpeningBalanceChanged = vendorData.openingBalance !== undefined || vendorData.openingBalanceType !== undefined;

        if (isOpeningBalanceChanged) {
            const newOpeningAmount = vendorData.openingBalance !== undefined ? vendorData.openingBalance : existingVendor.openingBalance;
            const newOpeningType = vendorData.openingBalanceType !== undefined ? vendorData.openingBalanceType : existingVendor.openingBalanceType;

            const syncedBalance = syncOutstandingBalance(
                existingVendor.openingBalance,
                existingVendor.openingBalanceType,
                newOpeningAmount,
                newOpeningType,
                existingVendor.outstandingBalance,
                existingVendor.outstandingBalanceType
            );

            updateData.outstandingBalance = syncedBalance.amount;
            updateData.outstandingBalanceType = syncedBalance.type;
        }

        const vendor = await Vendor.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        )
            .populate('group', 'name type slug');

        successResponse(res, "Vendor updated successfully", 200, vendor);
    } catch (error) {
        next(error);
    }
};

export const deleteVendor = async (req, res, next) => {
    const { id } = req?.params;
    try {
        const vendor = await Vendor.findByIdAndUpdate(
            id,
            { isActive: false },
            { new: true }
        );

        if (!vendor) {
            return res.status(404).json({ message: "Vendor not found" });
        }

        successResponse(res, "Vendor deleted successfully", 200, vendor);
    } catch (error) {
        next(error);
    }
};

export const getVendorLedger = async (req, res, next) => {
    const { id } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const skip = (page - 1) * limit;

    try {
        const vendor = await Vendor.findById(id);
        if (!vendor) {
            throw new AppError('Vendor not found', 404);
        }

        // Build Date Query
        const dateQuery = {};
        if (startDate || endDate) {
            dateQuery.date = {};
            if (startDate) dateQuery.date.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                dateQuery.date.$lte = end;
            }
        }

        // 1. Fetch Trips (Purchases)
        const tripQuery = {
            'purchases.supplier': id,
            status: { $in: ['completed', 'ongoing'] },
            ...dateQuery
        };
        const trips = await Trip.find(tripQuery)
            .populate('vehicle', 'vehicleNumber')
            .populate('supervisor', 'name')
            .populate('purchases.supplier', '_id vendorName')
            .lean();


        // 2. Fetch Vouchers (Payments/Receipts/Journals)
        const voucherQuery = {
            $or: [
                { party: id },
                {
                    'parties': {
                        $elemMatch: {
                            partyId: id,
                            partyType: 'vendor'
                        }
                    }
                },
                {
                    'entries.account': vendor.vendorName
                }
            ],
            isActive: true,
            ...dateQuery
        };

        const filterType = req.query.filterType;
        if (filterType === 'PURCHASE') {
            // Only include Purchase type vouchers if filtering for Purchases
            voucherQuery.voucherType = 'Purchase';
        }

        const vouchers = await Voucher.find(voucherQuery).lean();

        // 3. Fetch Indirect Sales
        const indirectSaleQuery = {
            vendor: id,
            isActive: true,
            // status: 'completed',
            ...dateQuery
        };
        const indirectSales = await IndirectSale.find(indirectSaleQuery).lean().populate('customer', '_id shopName ownerName');

        // 4. Fetch Inventory Stock Purchases (Direct Stock Additions)
        const stockQuery = {
            vendorId: id,
            type: { $in: ['purchase', 'opening'] }, // Include opening? maybe, check logic. Opening is usually separate. Let's stick to purchase if type is purchase.
            // But wait, the form saves type as 'purchase'. 
            ...dateQuery
        };
        const inventoryStocks = await InventoryStock.find(stockQuery)
            .populate('vehicleId', 'vehicleNumber')
            .populate('supervisorId', 'name')
            .lean();

        // 3. Calculate Opening Balance for the filtered period
        let periodOpeningBalance = vendor.openingBalance || 0;
        if (filterType === 'PURCHASE') {
            // If filtering for Purchases only, we show 0 opening balance to list only relevant records
            periodOpeningBalance = 0;
        } else {
            if (vendor.openingBalanceType === 'debit') {
                periodOpeningBalance = -periodOpeningBalance;
            }
        }

        if (startDate && filterType !== 'PURCHASE') {
            // Fetch all previous trips
            // ... (Only fetch previous balances if NOT filtering for specific records)
            // Fetch all previous trips
            const prevTrips = await Trip.find({
                'purchases.supplier': id,
                status: 'completed',
                date: { $lt: new Date(startDate) }
            }).lean();

            // Fetch all previous vouchers
            const prevVouchers = await Voucher.find({
                $or: [
                    { party: id },
                    {
                        'parties': {
                            $elemMatch: {
                                partyId: id,
                                partyType: 'vendor'
                            }
                        }
                    },
                    {
                        'entries.account': vendor.vendorName
                    }
                ],
                isActive: true,
                date: { $lt: new Date(startDate) }
            }).lean();

            // Fetch all previous Indirect Sales
            const prevIndirectSales = await IndirectSale.find({
                vendor: id,
                isActive: true,
                // status: 'completed',
                date: { $lt: new Date(startDate) }
            }).lean().populate('customer', '_id shopName ownerName');

            // Calculate impact of previous transactions
            for (const trip of prevTrips) {
                const purchases = trip.purchases.filter(p => p.supplier && p.supplier.toString() === id);
                for (const purchase of purchases) {
                    let tripAmount = purchase.amount || 0;

                    // Logic to deduct TDS from previous trips calculation if applicable
                    if (vendor.tdsApplicable && (vendor.tdsUpdatedAt && new Date(trip.date) > new Date(vendor.tdsUpdatedAt))) {
                        const tdsAmount = tripAmount * 0.001; // 0.1% TDS
                        tripAmount -= tdsAmount;
                    }

                    periodOpeningBalance += tripAmount; // Purchase increases payable (Credit), net of TDS
                }
            }

            for (const voucher of prevVouchers) {
                let amount = 0;
                let type = 'debit'; // default to reducing payable

                if (voucher.voucherType === 'Journal') {
                    const entry = voucher.entries.find(e => e.account === vendor.vendorName);
                    if (entry) {
                        if (entry.creditAmount > 0) {
                            amount = entry.creditAmount;
                            type = 'credit'; // Increases payable
                        } else {
                            amount = entry.debitAmount;
                            type = 'debit'; // Decreases payable
                        }
                    }
                } else {
                    if (voucher.parties && voucher.parties.length > 0) {
                        const partyEntry = voucher.parties.find(p => p.partyId && p.partyId.toString() === id && p.partyType === 'vendor');
                        amount = partyEntry ? partyEntry.amount : 0;
                    } else if (voucher.party && voucher.party.toString() === id) {
                        amount = voucher.totalDebit || voucher.totalCredit;
                    }
                    // For Payment/Receipt, we assume they reduce the payable (Debit)
                    // Unless it's a Receipt in a specific context, but used logic matches existing:
                    type = 'debit';
                }

                if (type === 'credit') {
                    periodOpeningBalance += amount;
                } else {
                    periodOpeningBalance -= amount;
                }
            }

            for (const sale of prevIndirectSales) {
                periodOpeningBalance += sale.summary?.totalPurchaseAmount || 0;
            }

            // Fetch previous Inventory Stocks
            const prevStocks = await InventoryStock.find({
                vendorId: id,
                type: { $in: ['purchase', 'opening'] },
                date: { $lt: new Date(startDate) }
            }).lean();

            for (const stock of prevStocks) {
                let stockAmount = stock.amount || 0;
                // Add TDS logic if needed here too, assuming consistent 
                if (vendor.tdsApplicable && (vendor.tdsUpdatedAt && new Date(stock.date) > new Date(vendor.tdsUpdatedAt))) {
                    const tdsAmount = stockAmount * 0.001;
                    stockAmount -= tdsAmount;
                }
                periodOpeningBalance += stockAmount;
            }
        }

        // 3. Normalize Data
        let ledgerEntries = [];

        // Process Trips
        for (const trip of trips) {
            const purchases = trip.purchases.filter(p => p.supplier && p.supplier._id.toString() === id);

            purchases.forEach((purchase, index) => {
                // Calculate TDS for current period trips
                let lessTDS = 0;
                if (vendor.tdsApplicable && (vendor.tdsUpdatedAt && new Date(trip.date) > new Date(vendor.tdsUpdatedAt))) {
                    lessTDS = (purchase.amount || 0) * 0.001; // 0.1% TDS
                }

                ledgerEntries.push({
                    _id: trip._id,
                    uniqueId: `TRIP-${trip._id}-${purchase._id || index}`, // Ensure unique ID for multiple purchases
                    date: trip.date,
                    type: 'PURCHASE',
                    particulars: 'PURCHASE',
                    liftingDate: trip.date,
                    deliveryDate: trip.completionDetails?.completedAt || trip.updatedAt,
                    vehicleNo: trip.vehicle?.vehicleNumber || '-',
                    driverName: trip.driver || '-',
                    supervisor: trip.supervisor?.name || '-',
                    dcNumber: purchase.dcNumber,
                    birds: purchase.birds,
                    weight: purchase.weight,
                    avgWeight: purchase.avgWeight,
                    rate: purchase.rate,
                    amount: purchase.amount,
                    lessTDS: lessTDS,
                    tripId: trip.tripId,
                    voucherNo: '-',
                    timestamp: new Date(trip.date).getTime()
                });
            });
        }

        // Process Indirect Sales
        for (const sale of indirectSales) {
            console.log("Indirect sale", sale.customer);
            sale.purchases.forEach((purchase, index) => {
                ledgerEntries.push({
                    _id: sale._id,
                    uniqueId: `INDIRECT-${sale._id}-${index}`,
                    date: sale.date,
                    type: 'PURCHASE',
                    particulars: 'INDIRECT_PURCHASE',
                    liftingDate: sale.date,
                    deliveryDate: sale.date,
                    vehicleNo: sale.vehicleNumber || '-',
                    driverName: sale.driver || '-',
                    supervisor: sale.customer?.ownerName + " ( Client )" || sale.customer?.shopName + " ( Client )" || '-',
                    dcNumber: purchase.dcNumber || '-',
                    birds: purchase.birds,
                    weight: purchase.weight,
                    avgWeight: purchase.avg || (purchase.birds > 0 ? purchase.weight / purchase.birds : 0),
                    rate: purchase.rate,
                    amount: purchase.amount,
                    lessTDS: 0,
                    tripId: '-',
                    voucherNo: sale.invoiceNumber || '-',
                    timestamp: new Date(sale.date).getTime()
                });
            });
        }

        // Process Inventory Stocks
        for (const stock of inventoryStocks) {
            let lessTDS = 0;
            if (vendor.tdsApplicable && (vendor.tdsUpdatedAt && new Date(stock.date) > new Date(vendor.tdsUpdatedAt))) {
                lessTDS = (stock.amount || 0) * 0.001;
            }

            ledgerEntries.push({
                _id: stock._id,
                uniqueId: `STOCK-${stock._id}`,
                date: stock.date,
                type: 'PURCHASE',
                particulars: stock.inventoryType === 'feed' ? 'Feed Purchase' : 'STOCK_PURCHASE',
                liftingDate: stock.date,
                deliveryDate: stock.date,
                vehicleNo: stock.vehicleId?.vehicleNumber || stock.vehicleNumber || '-',
                driverName: '-', // Stock doesn't usually track driver unless added
                supervisor: stock.supervisorId?.name || '-',
                dcNumber: stock.refNo || '-',
                birds: stock.birds,
                weight: stock.weight,
                avgWeight: stock.avgWeight || (stock.birds > 0 ? stock.weight / stock.birds : 0),
                rate: stock.rate,
                amount: stock.amount,
                lessTDS: lessTDS,
                tripId: '-',
                voucherNo: '-', // Could use RefNo if needed
                timestamp: new Date(stock.date).getTime(),
                narration: stock.notes || ''
            });
        }

        // Process Vouchers
        for (const voucher of vouchers) {
            let amount = 0;
            let amountType = 'debit'; // default

            if (voucher.voucherType === 'Journal') {
                const entry = voucher.entries.find(e => e.account === vendor.vendorName);
                if (entry) {
                    if (entry.creditAmount > 0) {
                        amount = entry.creditAmount;
                        amountType = 'credit';
                    } else {
                        amount = entry.debitAmount;
                        amountType = 'debit';
                    }
                }
            } else {
                if (voucher.parties && voucher.parties.length > 0) {
                    const partyEntry = voucher.parties.find(p => p.partyId && p.partyId.toString() === id && p.partyType === 'vendor');
                    amount = partyEntry ? partyEntry.amount : 0;
                } else if (voucher.party && voucher.party.toString() === id) {
                    amount = voucher.totalDebit || voucher.totalCredit;
                }
                amountType = 'debit';
            }

            if (amount > 0) {
                ledgerEntries.push({
                    _id: voucher._id,
                    uniqueId: `VOUCHER-${voucher._id}`,
                    date: voucher.date,
                    type: voucher.voucherType.toUpperCase(),
                    particulars: voucher.voucherType === 'Payment' ? 'PAYMENT' : (voucher.voucherType === 'Receipt' ? 'RECEIPT' : 'JOURNAL'),
                    vehicleNo: '-',
                    driverName: '-',
                    supervisor: '-',
                    dcNumber: '-',
                    birds: 0,
                    weight: 0,
                    avgWeight: 0,
                    rate: 0,
                    amount: amount,
                    lessTDS: 0,
                    tripId: '-',
                    voucherNo: voucher.voucherNumber ? `VCH-${voucher.voucherNumber}` : '-',
                    timestamp: new Date(voucher.date).getTime(),
                    amountType: amountType, // Store this for balance calc
                    narration: voucher.narration || ''
                });
            }
        }

        // 4. Sort by Date ASC
        ledgerEntries.sort((a, b) => a.timestamp - b.timestamp);

        // 5. Calculate Running Balance
        let runningBalance = periodOpeningBalance;

        let calculatedEntries = [];

        // Add Opening Balance Entry
        calculatedEntries.push({
            _id: 'op_bal',
            uniqueId: 'OP_BAL',
            date: startDate || vendor.createdAt, // Use filtered start date or vendor creation date
            type: 'OPENING',
            particulars: 'OP',
            vehicleNo: '-',
            driverName: '-',
            supervisor: '-',
            dcNumber: '-',
            birds: 0,
            weight: 0,
            avgWeight: 0,
            rate: 0,
            amount: 0,
            lessTDS: 0,
            tripId: '-',
            voucherNo: '-',
            balance: periodOpeningBalance,
            timestamp: 0 // Ensure it stays at top if sorting again, though we push it first
        });

        const transactionEntries = ledgerEntries.map(entry => {
            if (entry.type === 'PURCHASE') {
                runningBalance += entry.amount; // Credit (Payable increases)
                if (entry.lessTDS) {
                    runningBalance -= entry.lessTDS; // Reduce payable by TDS amount
                }
            } else if (entry.amountType === 'credit') {
                runningBalance += entry.amount; // Journal Credit increases Payable
            } else if (entry.amountType === 'debit' || entry.type === 'PAYMENT' || entry.type === 'RECEIPT') {
                // Payment, Receipt, or Journal Debit decreases Payable
                runningBalance -= entry.amount;
            }

            return {
                ...entry,
                balance: runningBalance
            };
        });

        calculatedEntries = [...calculatedEntries, ...transactionEntries];

        // 6. Pagination (Ascending Order - Oldest First)
        const totalItems = calculatedEntries.length;
        const totalPages = Math.ceil(totalItems / limit);
        const paginatedEntries = calculatedEntries.slice(skip, skip + limit);

        const totals = {
            totalBirds: trips.reduce((sum, t) => sum + (t.purchases.find(p => p.supplier && p.supplier._id.toString() === id)?.birds || 0), 0)
                + indirectSales.reduce((sum, s) => sum + (s.summary?.totalPurchaseBirds || 0), 0)
                + inventoryStocks.reduce((sum, s) => sum + (s.birds || 0), 0),

            totalWeight: trips.reduce((sum, t) => sum + (t.purchases.find(p => p.supplier && p.supplier._id.toString() === id)?.weight || 0), 0)
                + indirectSales.reduce((sum, s) => sum + (s.summary?.totalPurchaseWeight || 0), 0)
                + inventoryStocks.reduce((sum, s) => sum + (s.weight || 0), 0),

            totalAmount: trips.reduce((sum, t) => sum + (t.purchases.find(p => p.supplier && p.supplier._id.toString() === id)?.amount || 0), 0)
                + indirectSales.reduce((sum, s) => sum + (s.summary?.totalPurchaseAmount || 0), 0)
                + inventoryStocks.reduce((sum, s) => sum + (s.amount || 0), 0)
        };

        // Update Vendor Outstanding Balance (Only if no date filter is applied)
        if (!startDate && !endDate && calculatedEntries.length > 0) {
            const finalLedgerBalance = calculatedEntries[calculatedEntries.length - 1].balance;
            const newBalanceType = finalLedgerBalance >= 0 ? 'credit' : 'debit';
            const newBalanceAmount = Math.abs(finalLedgerBalance);

            // Only update if different to avoid unnecessary writes
            if (vendor.outstandingBalance !== newBalanceAmount || vendor.outstandingBalanceType !== newBalanceType) {
                await Vendor.findByIdAndUpdate(id, {
                    outstandingBalance: newBalanceAmount,
                    outstandingBalanceType: newBalanceType
                });
            }
        }

        successResponse(res, "Vendor ledger fetched successfully", 200, {
            ledger: paginatedEntries,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems,
                itemsPerPage: limit
            },
            vendor: {
                name: vendor.vendorName,
                openingBalance: vendor.openingBalance,
                currentBalance: vendor.outstandingBalance
            },
            totals
        });

    } catch (error) {
        next(error);
    }
};