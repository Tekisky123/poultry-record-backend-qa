import Group from "../models/Group.js";
import Ledger from "../models/Ledger.js";
import Customer from "../models/Customer.js";
import Vendor from "../models/Vendor.js";
import Voucher from "../models/Voucher.js";
import Trip from "../models/Trip.js";
import InventoryStock from "../models/InventoryStock.js";
import IndirectSale from "../models/IndirectSale.js";
import DieselStation from "../models/DieselStation.js";
import { successResponse } from "../utils/responseHandler.js";
import AppError from "../utils/AppError.js";
import { toSignedValue, fromSignedValue } from "../utils/balanceUtils.js";

// Helper function to check for circular references
const checkCircularReference = async (groupId, parentGroupId) => {
    if (!parentGroupId) return true;

    // Convert to string for comparison, handle null groupId (for new groups)
    const groupIdStr = groupId ? groupId.toString() : null;
    const parentGroupIdStr = parentGroupId.toString();

    if (groupIdStr && groupIdStr === parentGroupIdStr) {
        throw new AppError('A group cannot be its own parent', 400);
    }

    let currentParentId = parentGroupId;
    const visited = new Set();

    // Only add groupId to visited set if it exists (not null for new groups)
    if (groupIdStr) {
        visited.add(groupIdStr);
    }

    while (currentParentId) {
        const currentParentIdStr = currentParentId.toString();
        if (visited.has(currentParentIdStr)) {
            throw new AppError('Circular reference detected. This would create an infinite loop.', 400);
        }
        visited.add(currentParentIdStr);

        const parent = await Group.findById(currentParentId);
        if (!parent) break;
        currentParentId = parent.parentGroup;
    }

    return true;
};

export const addGroup = async (req, res, next) => {
    try {
        const { name, type, parentGroup } = req.body;

        // Validate parent group exists if provided
        if (parentGroup) {
            const parent = await Group.findById(parentGroup);
            if (!parent || !parent.isActive) {
                throw new AppError('Parent group not found or inactive', 404);
            }
            // Check for circular reference
            await checkCircularReference(null, parentGroup);
        }

        const groupData = {
            name,
            type,
            parentGroup: parentGroup || null,
            createdBy: req.user._id,
            updatedBy: req.user._id
        };

        const group = new Group(groupData);
        await group.save();

        const populatedGroup = await Group.findById(group._id)
            .populate('parentGroup', 'name type slug')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');

        successResponse(res, "New group added", 201, populatedGroup);
    } catch (error) {
        next(error);
    }
};

export const getGroups = async (req, res, next) => {
    try {
        const { type } = req.query;
        const query = { isActive: true };

        if (type) {
            query.type = type;
        }

        const groups = await Group.find(query)
            .populate('parentGroup', 'name type slug')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name')
            .sort({ name: 1 })
            .lean();

        // Get ledger counts for all groups in a single aggregation query
        const ledgerCounts = await Ledger.aggregate([
            { $match: { isActive: true, group: { $exists: true, $ne: null } } },
            { $group: { _id: '$group', count: { $sum: 1 } } }
        ]);

        // Create a map of groupId -> ledger count
        const countMap = {};
        ledgerCounts.forEach(item => {
            if (item._id) {
                countMap[item._id.toString()] = item.count;
            }
        });

        // Add ledger count to each group and normalize parentGroup
        const groupsWithCounts = groups.map(group => ({
            ...group,
            id: group._id.toString(),
            ledgerCount: countMap[group._id.toString()] || 0,
            parentGroup: group.parentGroup ? {
                ...group.parentGroup,
                id: group.parentGroup._id ? group.parentGroup._id.toString() : (group.parentGroup.id || null)
            } : null
        }));

        successResponse(res, "Groups retrieved successfully", 200, groupsWithCounts);
    } catch (error) {
        next(error);
    }
};

export const getGroupById = async (req, res, next) => {
    const { id } = req.params;
    try {
        const group = await Group.findOne({ _id: id, isActive: true })
            .populate('parentGroup', 'name type')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');

        if (!group) {
            throw new AppError('Group not found', 404);
        }

        // Get child groups
        const childGroups = await Group.find({ parentGroup: id, isActive: true })
            .populate('parentGroup', 'name type')
            .select('name type parentGroup');

        // Get ledgers in this group
        const ledgers = await Ledger.find({ group: id, isActive: true })
            .populate('vendor', 'vendorName')
            .populate('customer', 'shopName')
            .select('name ledgerType vendor customer');

        const groupData = {
            ...group.toObject(),
            childGroups,
            ledgers
        };

        successResponse(res, "Group retrieved successfully", 200, groupData);
    } catch (error) {
        next(error);
    }
};

export const updateGroup = async (req, res, next) => {
    const { id } = req.params;
    try {
        const { name, type, parentGroup } = req.body;

        const group = await Group.findById(id);
        if (!group || !group.isActive) {
            throw new AppError('Group not found', 404);
        }

        // Prevent editing predefined groups (optional - can be removed if needed)
        // if (group.isPredefined && (name !== group.name || type !== group.type)) {
        //     throw new AppError('Cannot modify name or type of predefined groups', 400);
        // }

        // Validate parent group if provided
        if (parentGroup) {
            if (parentGroup.toString() === id) {
                throw new AppError('A group cannot be its own parent', 400);
            }
            const parent = await Group.findById(parentGroup);
            if (!parent || !parent.isActive) {
                throw new AppError('Parent group not found or inactive', 404);
            }
            // Check for circular reference
            await checkCircularReference(id, parentGroup);
        }

        const updateData = {
            ...(name && { name }),
            ...(type && { type }),
            parentGroup: parentGroup !== undefined ? (parentGroup || null) : group.parentGroup,
            updatedBy: req.user._id
        };

        const updatedGroup = await Group.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        )
            .populate('parentGroup', 'name type slug')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');

        successResponse(res, "Group updated successfully", 200, updatedGroup);
    } catch (error) {
        next(error);
    }
};

export const deleteGroup = async (req, res, next) => {
    const { id } = req.params;
    try {
        const group = await Group.findById(id);
        if (!group || !group.isActive) {
            throw new AppError('Group not found', 404);
        }

        // Check if group has child groups
        const childGroups = await Group.countDocuments({ parentGroup: id, isActive: true });
        if (childGroups > 0) {
            throw new AppError('Cannot delete group with child groups. Please delete or move child groups first.', 400);
        }

        // Check if group has ledgers
        const ledgersCount = await Ledger.countDocuments({ group: id, isActive: true });
        if (ledgersCount > 0) {
            throw new AppError('Cannot delete group with ledgers. Please delete or move ledgers first.', 400);
        }

        // Soft delete
        const deletedGroup = await Group.findByIdAndUpdate(
            id,
            { isActive: false, updatedBy: req.user._id },
            { new: true }
        );

        successResponse(res, "Group deleted successfully", 200, deletedGroup);
    } catch (error) {
        next(error);
    }
};

export const getGroupsByType = async (req, res, next) => {
    const { type } = req.params;
    try {
        const validTypes = ['Liability', 'Assets', 'Expenses', 'Income', 'Others'];
        if (!validTypes.includes(type)) {
            throw new AppError('Invalid group type', 400);
        }

        const groups = await Group.find({ type, isActive: true })
            .populate('parentGroup', 'name type')
            .sort({ name: 1 });

        successResponse(res, `Groups of type ${type} retrieved successfully`, 200, groups);
    } catch (error) {
        next(error);
    }
};

// Calculate ledger balance from vouchers up to asOnDate

// Updated to accept ledgerDoc and calculate correctly using outstandingBalance
const calculateLedgerBalance = (ledgerDoc, startDate = null, endDate = null, preFetchedVouchers = null, preFetchedTrips = null, preFetchedStocks = null) => {
    try {
        let periodDebit = 0;
        let periodCredit = 0;
        let voucherAmount = 0;
        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;
        if (end) end.setHours(23, 59, 59, 999);

        const ledgerId = ledgerDoc._id;
        const ledgerName = ledgerDoc.name;

        // Process Vouchers (using logic from getLedgerTransactions)
        if (Array.isArray(preFetchedVouchers)) {
            preFetchedVouchers.forEach(v => {
                const vDate = new Date(v.date);
                if (end && vDate > end) return;

                // For period stats, we only count within start/end
                const isInPeriod = (!start || vDate >= start);

                let debit = 0;
                let credit = 0;
                let isMatch = false;

                // Determine Debit/Credit
                if (v.voucherType === 'Payment' || v.voucherType === 'Receipt') {
                    if (v.account && v.account.toString() === ledgerId.toString()) {
                        // Header match
                        const totalAmount = v.parties ? v.parties.reduce((sum, p) => sum + (p.amount || 0), 0) : 0;
                        if (v.voucherType === 'Payment') credit += totalAmount;
                        else debit += totalAmount;
                        isMatch = true;
                    }
                    if (v.parties) {
                        v.parties.forEach(p => {
                            if (p.partyId && p.partyId.toString() === ledgerId.toString()) {
                                if (v.voucherType === 'Payment') debit += p.amount || 0;
                                else credit += p.amount || 0;
                                isMatch = true;
                            }
                        });
                    }
                } else {
                    // Journal/Contra
                    if (v.entries) {
                        v.entries.forEach(e => {
                            if (e.account && e.account.toString().trim().toLowerCase() === ledgerName.trim().toLowerCase()) {
                                debit += e.debitAmount || 0;
                                credit += e.creditAmount || 0;
                                isMatch = true;
                            }
                        });
                    }
                }

                if (isInPeriod && isMatch) {
                    periodDebit += debit;
                    periodCredit += credit;
                    // Discount logic (heuristic: Journals are often adjustments/discounts)
                    if (v.voucherType === 'Journal' || v.voucherType === 'Contra') {
                        voucherAmount += (debit + credit);
                    }
                }
            });
        }

        // Process Trips
        if (Array.isArray(preFetchedTrips)) {
            preFetchedTrips.forEach(t => {
                const tDate = new Date(t.createdAt);
                if (end && tDate > end) return;
                const isInPeriod = (!start || tDate >= start);

                if (isInPeriod && t.sales) {
                    t.sales.forEach(s => {
                        let localDebit = 0;
                        if (s.cashLedger && s.cashLedger.toString() === ledgerId.toString()) {
                            localDebit += s.cashPaid || 0;
                        }
                        if (s.onlineLedger && s.onlineLedger.toString() === ledgerId.toString()) {
                            localDebit += s.onlinePaid || 0;
                        }
                        if (localDebit > 0) periodDebit += localDebit;
                    });
                }
            });
        }

        // Process Stocks
        if (Array.isArray(preFetchedStocks)) {
            preFetchedStocks.forEach(s => {
                const sDate = new Date(s.date);
                if (end && sDate > end) return;
                const isInPeriod = (!start || sDate >= start);

                if (isInPeriod) {
                    let debit = 0;
                    // Cash Payment
                    if (s.cashLedgerId && s.cashLedgerId.toString() === ledgerId.toString()) {
                        debit += s.cashPaid || 0;
                    }
                    // Online Payment
                    if (s.onlineLedgerId && s.onlineLedgerId.toString() === ledgerId.toString()) {
                        debit += s.onlinePaid || 0;
                    }
                    // Expense 
                    if (s.expenseLedgerId && s.expenseLedgerId.toString() === ledgerId.toString()) {
                        debit += s.amount || 0;
                    }
                    periodDebit += debit;
                }
            });
        }

        // Final Balance is trusted from DB
        const finalSigned = toSignedValue(ledgerDoc.outstandingBalance || 0, ledgerDoc.outstandingBalanceType || 'debit');

        // Calculated Opening = Closing - (Debit - Credit)
        // This opening balance is derived to make the math work for the period report
        const calculatedOpening = finalSigned - (periodDebit - periodCredit);

        return {
            debitTotal: periodDebit,
            creditTotal: periodCredit,
            finalBalance: finalSigned,
            openingBalance: calculatedOpening,
            discountAndOther: voucherAmount
        };
    } catch (error) {
        console.error('Error calculating ledger balance:', error);
        return { debitTotal: 0, creditTotal: 0, finalBalance: 0, openingBalance: 0 };
    }
};




// Calculate customer balance from vouchers and sales up to asOnDate
// Calculate customer balance (using logic from getCustomerPurchaseLedger)
const calculateCustomerBalance = (customerDoc, startDate = null, endDate = null, preFetchedVouchers = null, preFetchedTrips = null, preFetchedIndirectSales = null, preFetchedStocks = null) => {
    try {
        let periodDebit = 0; // Sales count as Debit (Receivable)
        let periodCredit = 0; // Receipts count as Credit
        let birdsTotal = 0;
        let weightTotal = 0;
        let discountAndOther = 0;

        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;
        if (end) end.setHours(23, 59, 59, 999);

        const customerId = customerDoc._id;
        const customerName = customerDoc.shopName || customerDoc.ownerName || '';

        // 1. Process Vouchers
        if (Array.isArray(preFetchedVouchers)) {
            preFetchedVouchers.forEach(v => {
                const vDate = new Date(v.date);
                if (end && vDate > end) return;
                const isInPeriod = (!start || vDate >= start);

                if (isInPeriod) {
                    let amount = 0;
                    let isMatch = false;
                    let type = '';

                    if (v.voucherType === 'Payment') {
                        const partyData = v.parties?.find(p => p.partyId && p.partyId.toString() === customerId.toString());
                        if (partyData) {
                            amount = partyData.amount || 0;
                            type = 'Payment'; // Treated as RECEIPT in Admin logic? No, wait.
                            // getCustomerPurchaseLedger: Payment Voucher -> Particulars = "RECEIPT" (Customer balance INCREASES? Line 1063: Balance + Amount)
                            // This is unusual. Usually Payment to Customer = Debit (Receivable increases or Liability decreases).
                            // We owe them money/refund? Or we gave them money?
                            // If we gave them money (Payment), they owe us more (Debit). 
                            // So Payment -> Debit.
                            periodDebit += amount;
                            isMatch = true;
                        }
                    } else if (v.voucherType === 'Receipt') {
                        // Receipt from Customer -> Credit (Decreases Receivable).
                        const partyData = v.parties?.find(p => p.partyId && p.partyId.toString() === customerId.toString());
                        if (partyData) {
                            amount = partyData.amount || 0;
                            periodCredit += amount;
                            isMatch = true;
                        }
                    } else {
                        // Journal
                        const entry = v.entries?.find(e => e.account === customerName);
                        if (entry) {
                            amount = entry.debitAmount || entry.creditAmount;
                            if (entry.debitAmount > 0) periodDebit += amount;
                            else periodCredit += amount;

                            // Add to Discount/Other if Journal
                            discountAndOther += amount;
                            isMatch = true;
                        }
                    }
                }
            });
        }

        // 2. Process Trips (Direct Sales)
        if (Array.isArray(preFetchedTrips)) {
            preFetchedTrips.forEach(trip => {
                const tDate = new Date(trip.createdAt);
                if (end && tDate > end) return;
                const isInPeriod = (!start || tDate >= start);

                if (isInPeriod && trip.sales) {
                    trip.sales.forEach(sale => {
                        if (sale.client && sale.client.toString() === customerId.toString()) {
                            // Sale Amount -> Debit
                            periodDebit += sale.amount || 0;
                            // Payments (Cash/Online) -> Credit
                            periodCredit += (sale.cashPaid || 0) + (sale.onlinePaid || 0) + (sale.discount || 0);

                            birdsTotal += (sale.birds || sale.birdsCount || 0);
                            weightTotal += sale.weight || 0;
                            discountAndOther += sale.discount || 0;
                        }
                    });
                }
            });
        }

        // 3. Process Indirect Sales
        if (Array.isArray(preFetchedIndirectSales)) {
            preFetchedIndirectSales.forEach(sale => {
                const sDate = new Date(sale.date);
                if (end && sDate > end) return;
                const isInPeriod = (!start || sDate >= start);

                if (isInPeriod && sale.customer && sale.customer.toString() === customerId.toString()) {
                    const salesInfo = sale.sales || {};
                    // Indirect Sale -> Debit
                    periodDebit += salesInfo.amount || 0;

                    birdsTotal += salesInfo.birds || 0;
                    weightTotal += salesInfo.weight || 0;
                }
            });
        }

        // 4. Process Stocks (Direct Sales via Manage Stocks)
        if (Array.isArray(preFetchedStocks)) {
            preFetchedStocks.forEach(stock => {
                const sDate = new Date(stock.date);
                if (end && sDate > end) return;
                const isInPeriod = (!start || sDate >= start);

                if (isInPeriod && stock.customerId && stock.customerId.toString() === customerId.toString()) {
                    if (stock.type === 'sale' || stock.type === 'receipt') {
                        if (stock.type === 'sale') {
                            periodDebit += stock.amount || 0;
                            birdsTotal += stock.birds || 0;
                            weightTotal += stock.weight || 0;
                        }
                        // Payments within stock
                        periodCredit += (stock.cashPaid || 0) + (stock.onlinePaid || 0) + (stock.discount || 0);
                        discountAndOther += stock.discount || 0;
                    }
                }
            });
        }

        const finalSigned = toSignedValue(customerDoc.outstandingBalance || 0, customerDoc.outstandingBalanceType || 'debit');
        const calculatedOpening = finalSigned - (periodDebit - periodCredit);

        return {
            debitTotal: periodDebit,
            creditTotal: periodCredit,
            finalBalance: finalSigned,
            openingBalance: calculatedOpening,
            birdsTotal,
            weightTotal,
            discountAndOther
        };
    } catch (error) {
        console.error('Error calculating customer balance:', error);
        return { debitTotal: 0, creditTotal: 0, finalBalance: 0, openingBalance: 0, birdsTotal: 0, weightTotal: 0 };
    }
};


// Calculate vendor balance from vouchers and purchases up to asOnDate
// Calculate vendor balance (using logic from getVendorLedger)
const calculateVendorBalance = (vendorDoc, startDate = null, endDate = null, preFetchedVouchers = null, preFetchedTrips = null, preFetchedStocks = null, preFetchedIndirectSales = null) => {
    try {
        let periodDebit = 0; // Payable Decreases (Payments)
        let periodCredit = 0; // Payable Increases (Purchases)
        let birdsTotal = 0;
        let weightTotal = 0;
        let discountAndOther = 0;

        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;
        if (end) end.setHours(23, 59, 59, 999);

        const vendorId = vendorDoc._id;
        const vendorName = vendorDoc.vendorName;

        // 1. Vouchers
        if (Array.isArray(preFetchedVouchers)) {
            preFetchedVouchers.forEach(v => {
                const vDate = new Date(v.date);
                if (end && vDate > end) return;
                const isInPeriod = (!start || vDate >= start);

                if (isInPeriod) {
                    let amount = 0;
                    let type = 'debit';

                    if (v.voucherType === 'Journal') {
                        const entry = v.entries?.find(e => e.account === vendorName);
                        if (entry) {
                            if (entry.creditAmount > 0) {
                                amount = entry.creditAmount;
                                type = 'credit';
                            } else {
                                amount = entry.debitAmount;
                                type = 'debit';
                            }
                        }
                    } else {
                        // Payment/Receipt
                        let isMatch = false;
                        if (v.parties && v.parties.length > 0) {
                            const partyEntry = v.parties.find(p => p.partyId && p.partyId.toString() === vendorId.toString() && p.partyType === 'vendor');
                            if (partyEntry) {
                                amount = partyEntry.amount || 0;
                                isMatch = true;
                            }
                        } else if (v.party && v.party.toString() === vendorId.toString()) { // Old schema support
                            amount = v.totalDebit || v.totalCredit;
                            isMatch = true;
                        }

                        if (isMatch) {
                            // Payment/Receipt usually reduces payable -> Debit
                            type = 'debit';
                        }
                    }

                    if (amount > 0) {
                        if (type === 'credit') {
                            periodCredit += amount;
                            if (v.voucherType === 'Journal' || v.voucherType === 'Receipt') discountAndOther += amount;
                        } else {
                            periodDebit += amount;
                        }
                    }
                }
            });
        }

        // 2. Trips (Purchases)
        if (Array.isArray(preFetchedTrips)) {
            preFetchedTrips.forEach(trip => {
                const tDate = new Date(trip.createdAt);
                if (end && tDate > end) return;
                const isInPeriod = (!start || tDate >= start);

                if (isInPeriod) {
                    trip.purchases.forEach(purchase => {
                        if (purchase.supplier && purchase.supplier.toString() === vendorId.toString()) {
                            let purchaseAmount = purchase.amount || 0;
                            // Check TDS
                            if (vendorDoc.tdsApplicable && (vendorDoc.tdsUpdatedAt && new Date(trip.date) > new Date(vendorDoc.tdsUpdatedAt))) {
                                const tds = purchaseAmount * 0.001;
                                // TDS reduces amount payable to vendor immediately?
                                // In getVendorLedger: Running Balance += purchase.amount, then -= lessTDS.
                                // So Purchase Amount is Credit. TDS is Debit.
                                periodDebit += tds;
                            }

                            periodCredit += purchaseAmount;
                            birdsTotal += purchase.birds || 0;
                            weightTotal += purchase.weight || 0;
                        }
                    });
                }
            });
        }

        // 3. Indirect Sales (Vendor is seller to company)
        if (Array.isArray(preFetchedIndirectSales)) {
            preFetchedIndirectSales.forEach(sale => {
                const sDate = new Date(sale.date);
                if (end && sDate > end) return;
                const isInPeriod = (!start || sDate >= start);

                if (isInPeriod && sale.vendor && sale.vendor.toString() === vendorId.toString()) {
                    // Vendor sold to us -> We owe them -> Credit
                    periodCredit += sale.summary?.totalPurchaseAmount || 0;
                    birdsTotal += sale.summary?.totalPurchaseBirds || 0;
                    weightTotal += sale.summary?.totalPurchaseWeight || 0;
                }
            });
        }

        // 4. Stocks (Purchases)
        if (Array.isArray(preFetchedStocks)) {
            preFetchedStocks.forEach(stock => {
                const sDate = new Date(stock.date);
                if (end && sDate > end) return;
                const isInPeriod = (!start || sDate >= start);

                const stockVendorId = stock.vendorId?._id || stock.vendorId;
                if (isInPeriod && stockVendorId && stockVendorId.toString() === vendorId.toString()) {
                    if (stock.type === 'purchase' || stock.type === 'opening') { // Typically purchase
                        let stockAmount = stock.amount || 0;
                        if (vendorDoc.tdsApplicable && (vendorDoc.tdsUpdatedAt && new Date(stock.date) > new Date(vendorDoc.tdsUpdatedAt))) {
                            const tds = stockAmount * 0.001;
                            periodDebit += tds;
                        }

                        periodCredit += stockAmount;
                        birdsTotal += stock.birds || 0;
                        weightTotal += stock.weight || 0;
                    }
                }
            });
        }

        const finalSigned = toSignedValue(vendorDoc.outstandingBalance || 0, vendorDoc.outstandingBalanceType || 'credit');
        // Vendor Opening: Closing - (Credit - Debit)  [Net Increase - Net Decrease]
        // Since Credit Increases balance for Vendor.
        const calculatedOpening = finalSigned - (periodCredit - periodDebit);

        return {
            debitTotal: periodDebit,
            creditTotal: periodCredit,
            finalBalance: finalSigned,
            openingBalance: calculatedOpening,
            birdsTotal,
            weightTotal,
            discountAndOther
        };
    } catch (error) {
        console.error('Error calculating vendor balance:', error);
        return { debitTotal: 0, creditTotal: 0, finalBalance: 0, openingBalance: 0, birdsTotal: 0, weightTotal: 0 };
    }
};


// Recursive function to get all ledgers in a group (including subgroups)
const getAllLedgersInGroup = async (groupId) => {
    // Get ledgers directly in this group
    const directLedgers = await Ledger.find({ group: groupId, isActive: true }).lean();

    // Get sub-groups
    const subGroups = await Group.find({ parentGroup: groupId, isActive: true }).lean();

    let allLedgers = [...directLedgers];

    // Recursively get ledgers from sub-groups
    for (const subGroup of subGroups) {
        const subGroupLedgers = await getAllLedgersInGroup(subGroup._id);
        allLedgers = [...allLedgers, ...subGroupLedgers];
    }

    return allLedgers;
};

// Recursive function to get all customers in a group
const getAllCustomersInGroup = async (groupId) => {
    const directCustomers = await Customer.find({ group: groupId, isActive: true }).lean();
    const subGroups = await Group.find({ parentGroup: groupId, isActive: true }).lean();

    let allCustomers = [...directCustomers];

    for (const subGroup of subGroups) {
        const subGroupCustomers = await getAllCustomersInGroup(subGroup._id);
        allCustomers = [...allCustomers, ...subGroupCustomers];
    }

    return allCustomers;
};

// Recursive function to get all vendors in a group
const getAllVendorsInGroup = async (groupId) => {
    const directVendors = await Vendor.find({ group: groupId, isActive: true }).lean();
    const subGroups = await Group.find({ parentGroup: groupId, isActive: true }).lean();

    let allVendors = [...directVendors];

    for (const subGroup of subGroups) {
        const subGroupVendors = await getAllVendorsInGroup(subGroup._id);
        allVendors = [...allVendors, ...subGroupVendors];
    }

    return allVendors;
};

// Calculate diesel station balance
const calculateDieselStationBalance = (stationDoc, startDate = null, endDate = null, preFetchedVouchers = null, preFetchedTrips = null) => {
    try {
        let periodDebit = 0; // Payments to station
        let periodCredit = 0; // Purchase from station
        let periodVolume = 0;
        let discountAndOther = 0;

        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;
        if (end) end.setHours(23, 59, 59, 999);

        const stationId = stationDoc._id;
        const stationName = stationDoc.name;

        // 1. Vouchers (Payments)
        if (Array.isArray(preFetchedVouchers)) {
            preFetchedVouchers.forEach(v => {
                const vDate = new Date(v.date);
                if (end && vDate > end) return;
                const isInPeriod = (!start || vDate >= start);

                if (isInPeriod) {
                    let amount = 0;
                    let isMatch = false;
                    let type = 'debit';

                    if (v.voucherType === 'Payment') {
                        // Check parties
                        const partyData = v.parties?.find(p => p.partyId && p.partyId.toString() === stationId.toString());
                        if (partyData) {
                            amount = partyData.amount || 0;
                            isMatch = true;
                            type = 'debit'; // Payment reduces liability
                        }
                    } else if (v.voucherType === 'Journal') {
                        // Journal check entries
                        const entry = v.entries?.find(e => e.account === stationName); // Assuming account name match for journal
                        if (entry) {
                            if (entry.creditAmount > 0) {
                                amount = entry.creditAmount;
                                type = 'credit';
                            } else {
                                amount = entry.debitAmount;
                                type = 'debit';
                            }
                            isMatch = true;
                        }
                    }

                    if (isMatch) {
                        if (type === 'credit') {
                            periodCredit += amount;
                            if (v.voucherType === 'Journal') discountAndOther += amount;
                        } else {
                            periodDebit += amount;
                        }
                    }
                }
            });
        }

        // 2. Trips (Purchases - Diesel Entries)
        if (Array.isArray(preFetchedTrips)) {
            preFetchedTrips.forEach(trip => {
                const tDate = new Date(trip.createdAt); // Or trip.date? Trip usually has createdAt or date. Using createdAt for consistency with other parts.
                // Actually trip.date is better if available, but controller mainly uses createdAt for trips in other funcs?
                // calculateVendorBalance uses createdAt (line 632). 

                if (end && tDate > end) return;
                const isInPeriod = (!start || tDate >= start);

                if (isInPeriod && trip.diesel && trip.diesel.stations) {
                    trip.diesel.stations.forEach(station => {
                        if (station.dieselStation && station.dieselStation.toString() === stationId.toString()) {
                            periodCredit += station.amount || 0;
                            periodVolume += station.volume || 0;
                        }
                    });
                }
            });
        }

        const finalSigned = toSignedValue(stationDoc.outstandingBalance || 0, stationDoc.outstandingBalanceType || 'credit');
        // Opening = Closing - (Credit - Debit) 
        const calculatedOpening = finalSigned - (periodCredit - periodDebit);

        return {
            debitTotal: periodDebit,
            creditTotal: periodCredit,
            finalBalance: finalSigned,
            openingBalance: calculatedOpening,
            discountAndOther,
            volume: periodVolume
        };
    } catch (error) {
        console.error('Error calculating diesel station balance:', error);
        return { debitTotal: 0, creditTotal: 0, finalBalance: 0, openingBalance: 0 };
    }
};

// Recursive function to get all diesel stations in a group
const getAllDieselStationsInGroup = async (groupId) => {
    const directStations = await DieselStation.find({ group: groupId, isActive: true }).lean();
    const subGroups = await Group.find({ parentGroup: groupId, isActive: true }).lean();

    let allStations = [...directStations];

    for (const subGroup of subGroups) {
        const subGroupStations = await getAllDieselStationsInGroup(subGroup._id);
        allStations = [...allStations, ...subGroupStations];
    }

    return allStations;
};

// Calculate group debit/credit from all ledgers, customers, and vendors
// OPTIMIZED: Uses pre-fetched data
const calculateGroupDebitCredit = async (groupId, groupType, startDate = null, endDate = null, preFetchedVouchers = null, preFetchedTrips = null, preFetchedStocks = null, preFetchedIndirectSales = null) => {
    // Note: getAllLedgers/Customers/Vendors still do recursive DB calls. 
    // Optimization: We could optimize these formatted calls too, but passing vouchers down is the biggest win.

    const allLedgers = await getAllLedgersInGroup(groupId);
    const allCustomers = await getAllCustomersInGroup(groupId);

    // Check group name for Purchase Account special case
    let allVendors = [];
    const groupDoc = await Group.findById(groupId).select('name');
    if (groupDoc && (groupDoc.name.trim().toLowerCase() === 'purchase account' || groupDoc.name.trim().toLowerCase() === 'purchase accounts')) {
        allVendors = await Vendor.find({ isActive: true }).lean();
    } else {
        allVendors = await getAllVendorsInGroup(groupId);
    }

    let totalDebit = 0; // Closing Debit
    let totalCredit = 0; // Closing Credit
    let totalBirds = 0;
    let totalWeight = 0;
    let totalTransactionDebit = 0;
    let totalTransactionCredit = 0;
    let totalDiscountAndOther = 0;

    // Calculate from ledgers
    for (const ledger of allLedgers) {
        const ledgerBalance = await calculateLedgerBalance(
            ledger,
            startDate,
            endDate,
            preFetchedVouchers,
            preFetchedTrips,
            preFetchedStocks
        );

        const finalSigned = ledgerBalance.finalBalance;
        totalTransactionDebit += ledgerBalance.debitTotal || 0;
        totalTransactionCredit += ledgerBalance.creditTotal || 0;
        totalDiscountAndOther += ledgerBalance.discountAndOther || 0;

        if (groupType === 'Assets' || groupType === 'Expenses') {
            if (finalSigned >= 0) {
                totalDebit += Math.abs(finalSigned);
            } else {
                totalCredit += Math.abs(finalSigned);
            }
        } else if (groupType === 'Liability' || groupType === 'Income') {
            if (finalSigned >= 0) {
                totalCredit += Math.abs(finalSigned);
            } else {
                totalDebit += Math.abs(finalSigned);
            }
        } else {
            // For Others type, use Assets logic
            if (finalSigned >= 0) {
                totalDebit += Math.abs(finalSigned);
            } else {
                totalCredit += Math.abs(finalSigned);
            }
        }
    }

    // Calculate from customers
    for (const customer of allCustomers) {
        const customerBalance = await calculateCustomerBalance(
            customer,
            startDate,
            endDate,
            preFetchedVouchers,
            preFetchedTrips,
            preFetchedIndirectSales,
            preFetchedStocks
        );

        const finalSigned = customerBalance.finalBalance;
        totalBirds += customerBalance.birdsTotal || 0;
        totalWeight += customerBalance.weightTotal || 0;
        totalTransactionDebit += customerBalance.debitTotal || 0;
        totalTransactionCredit += customerBalance.creditTotal || 0;
        totalDiscountAndOther += customerBalance.discountAndOther || 0;

        if (groupType === 'Assets' || groupType === 'Expenses') {
            if (finalSigned >= 0) {
                totalDebit += Math.abs(finalSigned);
            } else {
                totalCredit += Math.abs(finalSigned);
            }
        } else if (groupType === 'Liability' || groupType === 'Income') {
            if (finalSigned >= 0) {
                totalCredit += Math.abs(finalSigned);
            } else {
                totalDebit += Math.abs(finalSigned);
            }
        } else {
            if (finalSigned >= 0) {
                totalDebit += Math.abs(finalSigned);
            } else {
                totalCredit += Math.abs(finalSigned);
            }
        }
    }

    // Calculate from vendors
    for (const vendor of allVendors) {
        const vendorBalance = await calculateVendorBalance(
            vendor,
            startDate,
            endDate,
            preFetchedVouchers,
            preFetchedTrips,
            preFetchedStocks,
            preFetchedIndirectSales
        );

        const finalSigned = vendorBalance.finalBalance;
        totalBirds += vendorBalance.birdsTotal || 0;
        totalWeight += vendorBalance.weightTotal || 0;
        totalTransactionDebit += vendorBalance.debitTotal || 0;
        totalTransactionCredit += vendorBalance.creditTotal || 0;
        totalDiscountAndOther += vendorBalance.discountAndOther || 0;

        if (groupType === 'Assets' || groupType === 'Expenses') {
            if (finalSigned >= 0) {
                totalDebit += Math.abs(finalSigned);
            } else {
                totalCredit += Math.abs(finalSigned);
            }
        } else if (groupType === 'Liability' || groupType === 'Income') {
            if (finalSigned >= 0) {
                totalCredit += Math.abs(finalSigned);
            } else {
                totalDebit += Math.abs(finalSigned);
            }
        } else {
            if (finalSigned >= 0) {
                totalDebit += Math.abs(finalSigned);
            } else {
                totalCredit += Math.abs(finalSigned);
            }
        }
    }

    // Calculate from diesel stations
    const allStations = await getAllDieselStationsInGroup(groupId);
    for (const station of allStations) {
        const stationBalance = await calculateDieselStationBalance(
            station,
            startDate,
            endDate,
            preFetchedVouchers,
            preFetchedTrips
        );

        const finalSigned = stationBalance.finalBalance;
        totalTransactionDebit += stationBalance.debitTotal || 0;
        totalTransactionCredit += stationBalance.creditTotal || 0;
        totalDiscountAndOther += stationBalance.discountAndOther || 0;

        if (groupType === 'Assets' || groupType === 'Expenses') {
            if (finalSigned >= 0) {
                totalDebit += Math.abs(finalSigned);
            } else {
                totalCredit += Math.abs(finalSigned);
            }
        } else if (groupType === 'Liability' || groupType === 'Income') {
            if (finalSigned >= 0) {
                totalCredit += Math.abs(finalSigned);
            } else {
                totalDebit += Math.abs(finalSigned);
            }
        } else {
            if (finalSigned >= 0) {
                totalCredit += Math.abs(finalSigned);
            } else {
                totalDebit += Math.abs(finalSigned);
            }
        }
    }

    return {
        debit: totalDebit,
        credit: totalCredit,
        birds: totalBirds,
        weight: totalWeight,
        transactionDebit: totalTransactionDebit,
        transactionCredit: totalTransactionCredit,
        discountAndOther: totalDiscountAndOther
    };
};

// Get group summary with ledgers and sub-groups
export const getGroupSummary = async (req, res, next) => {
    const { id } = req.params;
    const { asOnDate, startDate, endDate } = req.query; // Added startDate and endDate

    // Determine the date range
    // If startDate and endDate are provided, use them.
    // If only asOnDate is provided, assume it's the end date and perform generic calc?
    // Maintain backward compatibility: if asOnDate is used, use it as endDate and startDate=null (infinite start)
    // But calculateCustomerBalance etc now handle startDate filtering.

    const finalEndDate = endDate || asOnDate;
    const finalStartDate = startDate || null;

    try {
        const group = await Group.findById(id).lean();
        if (!group || !group.isActive) {
            throw new AppError('Group not found', 404);
        }

        // Fetch all vouchers and trips once
        const voucherQuery = {
            isActive: true
        };
        if (finalEndDate) {
            const endDateObj = new Date(finalEndDate);
            endDateObj.setHours(23, 59, 59, 999);
            voucherQuery.date = { $lte: endDateObj };
        }
        const vouchers = await Voucher.find(voucherQuery).lean();

        // Fetch all trips for optimization
        const tripQuery = {};
        if (finalEndDate) {
            tripQuery.createdAt = { $lte: new Date(finalEndDate) };
        }
        const trips = await Trip.find(tripQuery).lean();

        // Fetch all inventory stocks for optimization
        const stockQuery = {};
        if (finalEndDate) {
            stockQuery.date = { $lte: new Date(finalEndDate) };
        }
        const stocks = await InventoryStock.find(stockQuery).lean();

        // Fetch Indirect Sales (was missing)
        const indirectSaleQuery = {};
        if (finalEndDate) {
            indirectSaleQuery.date = { $lte: new Date(finalEndDate) };
        }
        const indirectSales = await IndirectSale.find(indirectSaleQuery).lean();

        const subGroups = await Group.find({ parentGroup: id, isActive: true }).sort({ name: 1 }).lean();
        const directLedgers = await Ledger.find({ group: id, isActive: true }).sort({ name: 1 }).lean();
        const directCustomers = await Customer.find({ group: id, isActive: true }).sort({ shopName: 1 }).lean();

        // Special handling for Purchase Account group - include all vendors
        let directVendors = [];
        if (group.name.trim().toLowerCase() === 'purchase account' || group.name.trim().toLowerCase() === 'purchase accounts') {
            directVendors = await Vendor.find({ isActive: true }).sort({ vendorName: 1 }).lean();
        } else {
            directVendors = await Vendor.find({ group: id, isActive: true }).sort({ vendorName: 1 }).lean();
        }

        let entries = [];

        // Add sub-groups with their calculated debit/credit (sum of all ledgers in that group)
        for (const subGroup of subGroups) {
            const { debit, credit, birds, weight, transactionDebit, transactionCredit, discountAndOther } = await calculateGroupDebitCredit(
                subGroup._id,
                group.type,
                finalStartDate,
                finalEndDate,
                vouchers,
                trips,
                stocks,
                indirectSales
            );

            entries.push({
                type: 'subgroup',
                id: subGroup._id.toString(),
                name: subGroup.name,
                debit,
                credit,
                birds: birds || 0,
                weight: weight || 0,
                transactionDebit: transactionDebit || 0,
                transactionCredit: transactionCredit || 0,
                discountAndOther: discountAndOther || 0,
                closingBalance: (debit - credit)
            });
        }

        // Add direct ledgers (not in sub-groups)
        for (const ledger of directLedgers) {
            const openingBalance = ledger.openingBalance || 0;
            const openingBalanceType = ledger.openingBalanceType || 'debit';

            const ledgerBalance = await calculateLedgerBalance(
                ledger,
                finalStartDate,
                finalEndDate,
                vouchers,
                trips,
                stocks
            );

            const finalSigned = ledgerBalance.finalBalance;

            let debit = 0;
            let credit = 0;

            // For Assets: Debit increases, Credit decreases
            // For Liability: Credit increases, Debit decreases
            // For Income: Credit increases, Debit decreases (similar to Liability)
            // For Expenses: Debit increases, Credit decreases (similar to Assets)
            if (group.type === 'Assets' || group.type === 'Expenses') {
                if (finalSigned >= 0) {
                    debit = Math.abs(finalSigned);
                } else {
                    credit = Math.abs(finalSigned);
                }
            } else if (group.type === 'Liability' || group.type === 'Income') {
                if (finalSigned >= 0) {
                    credit = Math.abs(finalSigned);
                } else {
                    debit = Math.abs(finalSigned);
                }
            } else {
                // For Others type, use Assets logic
                if (finalSigned >= 0) {
                    debit = Math.abs(finalSigned);
                } else {
                    credit = Math.abs(finalSigned);
                }
            }

            entries.push({
                type: 'ledger',
                id: ledger._id.toString(),
                name: ledger.name,
                debit,
                credit,
                birds: 0,
                weight: 0,
                transactionDebit: ledgerBalance.debitTotal || 0,
                transactionCredit: ledgerBalance.creditTotal || 0,
                discountAndOther: ledgerBalance.discountAndOther || 0,
                closingBalance: finalSigned
            });
        }

        // Add customers
        for (const customer of directCustomers) {
            const openingBalance = customer.openingBalance || 0;
            const openingBalanceType = customer.openingBalanceType || 'debit';
            const customerName = customer.shopName || customer.ownerName || 'Customer';

            const customerBalance = await calculateCustomerBalance(
                customer,
                finalStartDate,
                finalEndDate,
                vouchers,
                trips,
                indirectSales,
                stocks
            );

            const finalSigned = customerBalance.finalBalance;

            let debit = 0;
            let credit = 0;

            if (group.type === 'Assets' || group.type === 'Expenses') {
                if (finalSigned >= 0) {
                    debit = Math.abs(finalSigned);
                } else {
                    credit = Math.abs(finalSigned);
                }
            } else if (group.type === 'Liability' || group.type === 'Income') {
                if (finalSigned >= 0) {
                    credit = Math.abs(finalSigned);
                } else {
                    debit = Math.abs(finalSigned);
                }
            } else {
                if (finalSigned >= 0) {
                    debit = Math.abs(finalSigned);
                } else {
                    credit = Math.abs(finalSigned);
                }
            }

            entries.push({
                type: 'customer',
                id: customer._id.toString(),
                name: customer.shopName,
                debit: debit,
                credit: credit,
                transactionDebit: customerBalance.debitTotal,
                transactionCredit: customerBalance.creditTotal,
                discountAndOther: customerBalance.discountAndOther || 0,
                closingBalance: finalSigned,
                birds: customerBalance.birdsTotal || 0,
                weight: customerBalance.weightTotal || 0
            });
        }

        // Add vendors
        for (const vendor of directVendors) {
            const vendorName = vendor.vendorName || 'Vendor';

            const vendorBalance = await calculateVendorBalance(
                vendor,
                finalStartDate,
                finalEndDate,
                vouchers,
                trips,
                stocks,
                indirectSales
            );

            const finalSigned = vendorBalance.finalBalance;
            let debit = 0;
            let credit = 0;

            if (group.type === 'Assets' || group.type === 'Expenses') {
                if (finalSigned >= 0) {
                    debit = Math.abs(finalSigned);
                } else {
                    credit = Math.abs(finalSigned);
                }
            } else if (group.type === 'Liability' || group.type === 'Income') {
                if (finalSigned >= 0) {
                    credit = Math.abs(finalSigned);
                } else {
                    debit = Math.abs(finalSigned);
                }
            } else {
                if (finalSigned >= 0) {
                    debit = Math.abs(finalSigned);
                } else {
                    credit = Math.abs(finalSigned);
                }
            }

            entries.push({
                type: 'vendor',
                id: vendor._id.toString(),
                name: vendor.vendorName,
                debit,
                credit,
                birds: vendorBalance.birdsTotal || 0,
                weight: vendorBalance.weightTotal || 0,
                transactionDebit: vendorBalance.debitTotal || 0,
                transactionCredit: vendorBalance.creditTotal || 0,
                discountAndOther: vendorBalance.discountAndOther || 0,
                closingBalance: finalSigned
            });
        }

        // Add diesel stations
        const directStations = await DieselStation.find({ group: id, isActive: true }).sort({ name: 1 }).lean();
        for (const station of directStations) {
            const stationBalance = await calculateDieselStationBalance(
                station,
                finalStartDate,
                finalEndDate,
                vouchers,
                trips
            );

            const finalSigned = stationBalance.finalBalance;
            let debit = 0;
            let credit = 0;

            if (group.type === 'Assets' || group.type === 'Expenses') {
                if (finalSigned >= 0) {
                    debit = Math.abs(finalSigned);
                } else {
                    credit = Math.abs(finalSigned);
                }
            } else if (group.type === 'Liability' || group.type === 'Income') {
                if (finalSigned >= 0) {
                    credit = Math.abs(finalSigned);
                } else {
                    debit = Math.abs(finalSigned);
                }
            } else {
                if (finalSigned >= 0) {
                    credit = Math.abs(finalSigned); // Stations usually credit balance (Vendor-like)
                } else {
                    debit = Math.abs(finalSigned);
                }
            }

            entries.push({
                type: 'dieselStation',
                id: station._id.toString(),
                name: station.name,
                debit,
                credit,
                birds: 0,
                weight: 0,
                volume: stationBalance.volume || 0,
                transactionDebit: stationBalance.debitTotal || 0,
                transactionCredit: stationBalance.creditTotal || 0,
                discountAndOther: stationBalance.discountAndOther || 0,
                closingBalance: finalSigned
            });
        }

        // Calculate totals
        const totals = entries.reduce((acc, entry) => ({
            debit: acc.debit + (entry.debit || 0),
            credit: acc.credit + (entry.credit || 0),
            birds: acc.birds + (entry.birds || 0),
            weight: acc.weight + (entry.weight || 0),
            volume: acc.volume + (entry.volume || 0),
            discountAndOther: acc.discountAndOther + (entry.discountAndOther || 0)
        }), { debit: 0, credit: 0, birds: 0, weight: 0, volume: 0, discountAndOther: 0 });

        successResponse(res, "Group summary retrieved", 200, {
            group: {
                _id: group._id,
                name: group.name,
                type: group.type,
                parentGroup: group.parentGroup
            },
            entries,
            totals,
            dateRange: {
                startDate: finalStartDate,
                endDate: finalEndDate
            }
        });
    } catch (error) {
        next(error);
    }
};
