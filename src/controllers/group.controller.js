import Group from "../models/Group.js";
import Ledger from "../models/Ledger.js";
import Customer from "../models/Customer.js";
import Vendor from "../models/Vendor.js";
import Voucher from "../models/Voucher.js";
import Trip from "../models/Trip.js";
import InventoryStock from "../models/InventoryStock.js";
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

// Updated to accept ledgerName and calculate correctly
const calculateLedgerBalance = async (ledgerId, ledgerName, openingBalance, openingBalanceType, startDate = null, endDate = null, preFetchedVouchers = null, preFetchedTrips = null) => {
    try {
        let periodDebit = 0;
        let periodCredit = 0;
        let openingMovement = 0;

        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;
        if (end) {
            end.setHours(23, 59, 59, 999);
        }

        let vouchers = preFetchedVouchers;

        if (!vouchers) {
            const query = {
                isActive: true
            };
            if (end) {
                query.date = { $lte: end };
            }
            vouchers = await Voucher.find(query).lean();
        }

        if (Array.isArray(vouchers)) {
            vouchers.forEach(voucher => {
                const vDate = new Date(voucher.date);
                if (end && vDate > end) return;

                // Only consider posted vouchers
                // if (voucher.status && voucher.status !== 'posted') return;

                const isBeforeStart = start && vDate < start;
                let vDebit = 0;
                let vCredit = 0;

                const ledgerIdStr = ledgerId.toString();
                const ledgerNameStr = ledgerName ? ledgerName.trim().toLowerCase() : '';

                // 1. Check entries (Journal, Contra, or Payment/Receipt splits)
                if (voucher.entries) {
                    voucher.entries.forEach(entry => {
                        let isMatch = false;
                        if (entry.account) {
                            const entryAcc = entry.account.toString().trim().toLowerCase();
                            // Match by Name or ID
                            if (entryAcc === ledgerNameStr || entryAcc === ledgerIdStr) {
                                isMatch = true;
                            }
                        }

                        if (isMatch) {
                            vDebit += entry.debitAmount || 0;
                            vCredit += entry.creditAmount || 0;
                        }
                    });
                }

                // 2. Check parties (Payment/Receipt line items where partyType is 'ledger')
                if ((voucher.voucherType === 'Payment' || voucher.voucherType === 'Receipt') && voucher.parties) {
                    voucher.parties.forEach(party => {
                        if (party.partyType === 'ledger' && party.partyId && party.partyId.toString() === ledgerIdStr) {
                            if (voucher.voucherType === 'Payment') {
                                // Payment to ledger: Ledger gets Debited 
                                vDebit += party.amount || 0;
                            } else if (voucher.voucherType === 'Receipt') {
                                // Receipt from ledger: Ledger gets Credited 
                                vCredit += party.amount || 0;
                            }
                        }
                    });
                }

                // 3. Check account (Payment/Receipt Header - e.g. Cash/Bank Ledger)
                if ((voucher.voucherType === 'Payment' || voucher.voucherType === 'Receipt') && voucher.account) {
                    if (voucher.account.toString() === ledgerIdStr) {
                        const totalAmount = voucher.parties ? voucher.parties.reduce((sum, p) => sum + (p.amount || 0), 0) : 0;

                        if (voucher.voucherType === 'Payment') {
                            // Payment from Account: Account gets Credited 
                            vCredit += totalAmount;
                        } else if (voucher.voucherType === 'Receipt') {
                            // Receipt to Account: Account gets Debited 
                            vDebit += totalAmount;
                        }
                    }
                }

                if (isBeforeStart) {
                    openingMovement += (vDebit - vCredit);
                } else {
                    periodDebit += vDebit;
                    periodCredit += vCredit;
                }
            });
        }

        // Get trips
        let trips = preFetchedTrips;
        if (!trips) {
            // Only fetch if we suspect this ledger might be involved in trips (Cash/Bank)
            // Or just fetch matching trips
            const tripQuery = {
                $or: [
                    { 'sales.cashLedger': ledgerId },
                    { 'sales.onlineLedger': ledgerId }
                ]
            };
            if (end) {
                // optimize: use date from trip schema if possible, but createdAt is used elsewhere
                tripQuery.createdAt = { $lte: end };
            }
            // Only fetch if we really need to? For now, let's fetch.
            // Note: Trip imports might be needed if not present (it is imported at top)
            trips = await Trip.find(tripQuery).lean();
        }

        if (Array.isArray(trips)) {
            trips.forEach(trip => {
                const tDate = new Date(trip.createdAt); // Consistent with Vendor/Customer calc
                if (end && tDate > end) return;

                const isBeforeStart = start && tDate < start;
                let tDebit = 0;
                let tCredit = 0;

                if (trip.sales) {
                    trip.sales.forEach(sale => {
                        // Cash Payment received -> Debit Cash Ledger
                        if (sale.cashLedger && sale.cashLedger.toString() === ledgerId.toString()) {
                            tDebit += (sale.cashPaid || 0);
                        }
                        // Online Payment received -> Debit Bank Ledger
                        if (sale.onlineLedger && sale.onlineLedger.toString() === ledgerId.toString()) {
                            tDebit += (sale.onlinePaid || 0);
                        }
                    });
                }

                if (isBeforeStart) {
                    openingMovement += (tDebit - tCredit);
                } else {
                    periodDebit += tDebit;
                    periodCredit += tCredit;
                }
            });
        }

        // Start with opening balance
        const openingSigned = toSignedValue(openingBalance || 0, openingBalanceType || 'debit');

        // Total flow
        const calculatedOpening = openingSigned + openingMovement;
        const finalSigned = calculatedOpening + periodDebit - periodCredit;

        // Calculate Discount & Other for Ledger
        let discountAndOther = 0;
        if (Array.isArray(vouchers)) {
            vouchers.forEach(voucher => {
                const vDate = new Date(voucher.date);
                if (end && vDate > end) return;

                let isMatch = false;
                let amount = 0;

                // Match Logic (simplified from main loop)
                const ledgerIdStr = ledgerId.toString();
                const ledgerNameStr = ledgerName ? ledgerName.trim().toLowerCase() : '';

                if (voucher.entries) {
                    voucher.entries.forEach(entry => {
                        const entryAcc = entry.account ? entry.account.toString().trim().toLowerCase() : '';
                        if (entryAcc === ledgerNameStr || entryAcc === ledgerIdStr) {
                            isMatch = true;
                            amount += (entry.debitAmount || 0) + (entry.creditAmount || 0);
                        }
                    });
                }
                if (!isMatch && (voucher.voucherType === 'Payment' || voucher.voucherType === 'Receipt') && voucher.parties) {
                    voucher.parties.forEach(party => {
                        if (party.partyType === 'ledger' && party.partyId && party.partyId.toString() === ledgerIdStr) {
                            isMatch = true;
                            amount += party.amount || 0;
                        }
                    });
                }
                if (!isMatch && (voucher.voucherType === 'Payment' || voucher.voucherType === 'Receipt') && voucher.account) {
                    if (voucher.account.toString() === ledgerIdStr) {
                        const totalAmount = voucher.parties ? voucher.parties.reduce((sum, p) => sum + (p.amount || 0), 0) : 0;
                        isMatch = true;
                        amount += totalAmount;
                    }
                }

                if (isMatch) {
                    // Logic: Journal included
                    if (voucher.voucherType !== 'Receipt' && voucher.voucherType !== 'Payment') {
                        discountAndOther += amount;
                    }
                }
            });
        }

        return {
            debitTotal: periodDebit,
            creditTotal: periodCredit,
            finalBalance: finalSigned,
            openingBalance: calculatedOpening,
            discountAndOther
        };
    } catch (error) {
        console.error('Error calculating ledger balance:', error);
        return { debitTotal: 0, creditTotal: 0, finalBalance: 0, openingBalance: 0 };
    }
};

// Calculate customer balance from vouchers and sales up to asOnDate
const calculateCustomerBalance = async (customerId, customerName, openingBalance, openingBalanceType, startDate = null, endDate = null, preFetchedVouchers = null, preFetchedTrips = null) => {
    try {
        let periodDebit = 0;
        let periodCredit = 0;
        let birdsTotal = 0;
        let weightTotal = 0;
        let openingMovement = 0;

        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;

        // Get vouchers
        let vouchers = preFetchedVouchers;
        if (!vouchers) {
            const voucherQuery = {
                isActive: true,
                // status: 'posted'
            };
            if (end) {
                voucherQuery.date = { $lte: end };
            }
            vouchers = await Voucher.find(voucherQuery).lean();
        }

        // Process vouchers
        vouchers.forEach(voucher => {
            const vDate = new Date(voucher.date);
            if (end && vDate > end) return;
            // if (voucher.status !== 'posted') return;

            const isBeforeStart = start && vDate < start;
            let vDebit = 0;
            let vCredit = 0;

            // Check Payment/Receipt vouchers with parties array
            if ((voucher.voucherType === 'Payment' || voucher.voucherType === 'Receipt') && voucher.parties) {
                voucher.parties.forEach(party => {
                    if (party.partyId && party.partyId.toString() === customerId.toString() && party.partyType === 'customer') {
                        if (voucher.voucherType === 'Payment') {
                            vDebit += party.amount || 0;
                        } else if (voucher.voucherType === 'Receipt') {
                            vCredit += party.amount || 0;
                        }
                    }
                });
            }

            // Check entries array for customer name match (backup legacy check)
            voucher.entries.forEach(entry => {
                if (entry.account && entry.account.trim().toLowerCase() === customerName.trim().toLowerCase()) {
                    vDebit += entry.debitAmount || 0;
                    vCredit += entry.creditAmount || 0;
                }
            });

            if (isBeforeStart) {
                openingMovement += (vDebit - vCredit);
            } else {
                periodDebit += vDebit;
                periodCredit += vCredit;
            }
        });

        // Get trips
        let trips = preFetchedTrips;
        if (!trips) {
            const tripQuery = {
                'sales.client': customerId,
                'sales.isReceipt': { $ne: true }
            };
            if (end) {
                tripQuery.createdAt = { $lte: end };
            }
            trips = await Trip.find(tripQuery).lean();
        }

        trips.forEach(trip => {
            const tDate = new Date(trip.createdAt);
            if (end && tDate > end) return;

            const isBeforeStart = start && tDate < start;

            let tDebit = 0;
            let tCredit = 0;

            trip.sales.forEach(sale => {
                if (sale.client && sale.client.toString() === customerId.toString() && !sale.isReceipt) {
                    // Sales increase customer balance (debit to customer)
                    tDebit += sale.amount || 0;
                    // Payments decrease customer balance (credit to customer)
                    tCredit += (sale.cashPaid || 0) + (sale.onlinePaid || 0) + (sale.discount || 0);

                    if (!isBeforeStart) {
                        // Add birds and weight only for period
                        birdsTotal += sale.birds || 0;
                        weightTotal += sale.weight || 0;
                    }
                }
            });

            if (isBeforeStart) {
                openingMovement += (tDebit - tCredit);
            } else {
                periodDebit += tDebit;
                periodCredit += tCredit;
            }
        });

        // Start with opening balance
        const openingSigned = toSignedValue(openingBalance || 0, openingBalanceType || 'debit');
        const calculatedOpening = openingSigned + openingMovement;
        const finalSigned = calculatedOpening + periodDebit - periodCredit;

        // Calculate Discount & Other (Matching customer.controller.js logic)
        let discountAndOther = 0;

        // 1. From Vouchers
        if (Array.isArray(vouchers)) {
            vouchers.forEach(voucher => {
                const vDate = new Date(voucher.date);
                if (end && vDate > end) return;
                // if (voucher.status !== 'posted') return; // consistency with main loop

                let isMatch = false;
                let amount = 0;

                // Check parties
                if (voucher.parties) {
                    voucher.parties.forEach(party => {
                        if (party.partyId && party.partyId.toString() === customerId.toString() && party.partyType === 'customer') {
                            isMatch = true;
                            amount += party.amount || 0;
                        }
                    });
                }

                // Check entries (backup)
                if (!isMatch && voucher.entries) {
                    voucher.entries.forEach(entry => {
                        if (entry.account && entry.account.trim().toLowerCase() === customerName.trim().toLowerCase()) {
                            isMatch = true;
                            // Add max(debit, credit) as amount
                            amount += (entry.debitAmount || 0) + (entry.creditAmount || 0);
                        }
                    });
                }

                if (isMatch) {
                    // Logic: 
                    // Payment Voucher -> 'RECEIPT' (Excluded)
                    // Receipt Voucher -> 'PAYMENT' (Included) - Customer pays us
                    // Journal Voucher -> 'JOURNAL' (Included)

                    if (voucher.voucherType !== 'Receipt' && voucher.voucherType !== 'Payment') {
                        discountAndOther += amount;
                    }
                }
            });
        }

        // 2. From Trips (Sales)
        if (Array.isArray(trips)) {
            trips.forEach(trip => {
                const tDate = new Date(trip.createdAt);
                if (end && tDate > end) return;

                if (trip.sales) {
                    trip.sales.forEach(sale => {
                        if (sale.client && sale.client.toString() === customerId.toString()) {
                            discountAndOther += sale.discount || 0;
                        }
                    });
                }
            });
        }

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
// Calculate vendor balance from vouchers and purchases up to asOnDate
const calculateVendorBalance = async (vendorId, vendorName, startDate = null, endDate = null, preFetchedVouchers = null, preFetchedTrips = null, preFetchedStocks = null) => {
    try {
        let periodDebit = 0;
        let periodCredit = 0;
        let birdsTotal = 0;
        let weightTotal = 0;
        let openingMovement = 0; // Vendors usually have Credit opening balance (negative in signed calc)

        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;

        // Get vouchers
        let vouchers = preFetchedVouchers;
        if (!vouchers) {
            const voucherQuery = {
                isActive: true,
                // status: 'posted'
            };
            if (end) {
                voucherQuery.date = { $lte: end };
            }
            vouchers = await Voucher.find(voucherQuery).lean();
        }

        // Process vouchers
        vouchers.forEach(voucher => {
            const vDate = new Date(voucher.date);
            if (end && vDate > end) return;
            // if (voucher.status !== 'posted') return;

            const isBeforeStart = start && vDate < start;
            let vDebit = 0;
            let vCredit = 0;

            // Check Payment/Receipt vouchers with parties array
            if ((voucher.voucherType === 'Payment' || voucher.voucherType === 'Receipt') && voucher.parties) {
                voucher.parties.forEach(party => {
                    if (party.partyId && party.partyId.toString() === vendorId.toString() && party.partyType === 'vendor') {
                        if (voucher.voucherType === 'Payment') {
                            // Payment: vendor balance increases (debit to vendor - we owe them more)
                            vDebit += party.amount || 0;
                        } else if (voucher.voucherType === 'Receipt') {
                            // Receipt: vendor balance decreases (credit to vendor - we pay them)
                            vCredit += party.amount || 0;
                        }
                    }
                });
            }

            // Check entries array for vendor name match
            voucher.entries.forEach(entry => {
                if (entry.account && entry.account.trim().toLowerCase() === vendorName.trim().toLowerCase()) {
                    vDebit += entry.debitAmount || 0;
                    vCredit += entry.creditAmount || 0;
                }
            });

            if (isBeforeStart) {
                openingMovement += (vDebit - vCredit);
            } else {
                periodDebit += vDebit;
                periodCredit += vCredit;
            }
        });

        // Get trips
        let trips = preFetchedTrips;
        if (!trips) {
            const tripQuery = {
                'purchases.supplier': vendorId
            };
            if (end) {
                tripQuery.createdAt = { $lte: end };
            }
            trips = await Trip.find(tripQuery).lean();
        }

        trips.forEach(trip => {
            const tDate = new Date(trip.createdAt);
            if (end && tDate > end) return;

            const isBeforeStart = start && tDate < start;
            let tDebit = 0;
            let tCredit = 0;

            trip.purchases.forEach(purchase => {
                if (purchase.supplier && purchase.supplier.toString() === vendorId.toString()) {
                    // Purchases increase vendor balance (Credit to Vendor)
                    tCredit += purchase.amount || 0;

                    if (!isBeforeStart) {
                        // Add birds and weight only for period
                        birdsTotal += purchase.birds || 0;
                        weightTotal += purchase.weight || 0;
                    }
                }
            });

            if (isBeforeStart) {
                openingMovement += (tDebit - tCredit); // Purchases are credit, so this will be negative
            } else {
                periodDebit += tDebit;
                periodCredit += tCredit;
            }
        });

        // Get Inventory Stocks (Feed Purchases, Opening Stock, etc.)
        let stocks = preFetchedStocks;
        if (!stocks) {
            const stockQuery = {
                vendorId: vendorId,
                // type: { $in: ['purchase', 'opening'] }
            };
            if (end) {
                stockQuery.date = { $lte: end };
            }
            stocks = await InventoryStock.find(stockQuery).lean();
        }

        if (Array.isArray(stocks)) {
            stocks.forEach(stock => {
                const sDate = new Date(stock.date);
                if (end && sDate > end) return;

                // Ensure it belongs to this vendor (double check if preFetched)
                const stockVendorId = stock.vendorId?._id || stock.vendorId;
                if (!stockVendorId || stockVendorId.toString() !== vendorId.toString()) return;

                const isBeforeStart = start && sDate < start;
                let sDebit = 0;
                let sCredit = 0;

                // Purchase or Opening Stock -> Credit to Vendor (Liability)
                if (stock.type === 'purchase' || stock.type === 'opening') {
                    sCredit += stock.amount || 0;
                }

                if (isBeforeStart) {
                    openingMovement += (sDebit - sCredit);
                } else {
                    periodDebit += sDebit;
                    periodCredit += sCredit;

                    // Add birds/weight for period
                    if (stock.type === 'purchase' || stock.type === 'opening') {
                        birdsTotal += stock.birds || 0;
                        weightTotal += stock.weight || 0;
                    }
                }
            });
        }


        // Vendors don't have opening balance usually, but if they do:
        // Start with opening balance (assuming 0 if not provided)
        // Vendor opening balance is usually 'credit' (liability for us)
        const openingBalance = 0; // Assuming vendors don't have explicit opening balance in this context
        const openingBalanceType = 'credit'; // Default for vendors
        const openingSigned = toSignedValue(openingBalance, openingBalanceType);
        const calculatedOpening = openingSigned + openingMovement;
        const finalSigned = calculatedOpening + periodDebit - periodCredit;

        // Calculate Discount & Other
        // Logic: Journal + Receipt (Money In). Exclude Payment (Money Out).
        let discountAndOther = 0;

        if (Array.isArray(vouchers)) {
            vouchers.forEach(voucher => {
                const vDate = new Date(voucher.date);
                if (end && vDate > end) return;

                let isMatch = false;
                let amount = 0;

                if (voucher.parties) {
                    voucher.parties.forEach(party => {
                        if (party.partyId && party.partyId.toString() === vendorId.toString() && party.partyType === 'vendor') {
                            isMatch = true;
                            amount += party.amount || 0;
                        }
                    });
                }

                if (!isMatch && voucher.entries) {
                    voucher.entries.forEach(entry => {
                        if (entry.account && entry.account.trim().toLowerCase() === vendorName.trim().toLowerCase()) {
                            isMatch = true;
                            amount += (entry.debitAmount || 0) + (entry.creditAmount || 0);
                        }
                    });
                }

                if (isMatch) {
                    if (voucher.voucherType === 'Receipt' || voucher.voucherType === 'Journal') {
                        discountAndOther += amount;
                    }
                }
            });
        }

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

// Calculate group debit/credit from all ledgers, customers, and vendors
// OPTIMIZED: Uses pre-fetched data
const calculateGroupDebitCredit = async (groupId, groupType, startDate = null, endDate = null, preFetchedVouchers = null, preFetchedTrips = null, preFetchedStocks = null) => {
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
        const openingBalance = ledger.openingBalance || 0;
        const openingBalanceType = ledger.openingBalanceType || 'debit';

        const ledgerBalance = await calculateLedgerBalance(
            ledger._id,
            ledger.name, // Pass ledger name
            openingBalance,
            openingBalanceType,
            startDate,
            endDate,
            preFetchedVouchers,
            preFetchedTrips
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
        const openingBalance = customer.openingBalance || 0;
        const openingBalanceType = customer.openingBalanceType || 'debit';
        const customerName = customer.shopName || customer.ownerName || 'Customer';

        const customerBalance = await calculateCustomerBalance(
            customer._id,
            customerName,
            openingBalance,
            openingBalanceType,
            startDate,
            endDate,
            preFetchedVouchers,
            preFetchedTrips
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
        const vendorName = vendor.vendorName || 'Vendor';

        const vendorBalance = await calculateVendorBalance(
            vendor._id,
            vendorName,
            startDate,
            endDate,
            preFetchedVouchers,
            preFetchedTrips,
            preFetchedStocks
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
                stocks
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
                ledger._id,
                ledger.name, // Pass ledger name
                openingBalance,
                openingBalanceType,
                finalStartDate,
                finalEndDate,
                vouchers,
                trips
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
                customer._id,
                customerName,
                openingBalance,
                openingBalanceType,
                finalStartDate,
                finalEndDate,
                vouchers,
                trips
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
                vendor._id,
                vendorName,
                finalStartDate,
                finalEndDate,
                vouchers,
                trips,
                stocks
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

        // Calculate totals
        const totals = entries.reduce((acc, entry) => ({
            debit: acc.debit + (entry.debit || 0),
            credit: acc.credit + (entry.credit || 0),
            birds: acc.birds + (entry.birds || 0),
            weight: acc.weight + (entry.weight || 0),
            discountAndOther: acc.discountAndOther + (entry.discountAndOther || 0)
        }), { debit: 0, credit: 0, birds: 0, weight: 0, discountAndOther: 0 });

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
