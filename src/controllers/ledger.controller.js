import Ledger from "../models/Ledger.js";
import Group from "../models/Group.js";
import Vendor from "../models/Vendor.js";
import Customer from "../models/Customer.js";
import Trip from "../models/Trip.js";
import Voucher from "../models/Voucher.js";
import InventoryStock from "../models/InventoryStock.js";
import IndirectSale from "../models/IndirectSale.js";
import DieselStation from "../models/DieselStation.js";
import { toSignedValue, fromSignedValue, syncOutstandingBalance } from "../utils/balanceUtils.js";
import { successResponse } from "../utils/responseHandler.js";
import AppError from "../utils/AppError.js";

export const addLedger = async (req, res, next) => {
    try {
        const { name, group, openingBalance, openingBalanceType, outstandingBalance, outstandingBalanceType } = req.body;

        // Validate required fields
        if (!name) {
            throw new AppError('Ledger name is required', 400);
        }

        // Validate group exists
        const groupDoc = await Group.findById(group);
        if (!groupDoc || !groupDoc.isActive) {
            throw new AppError('Group not found or inactive', 404);
        }

        const openingValue = openingBalance || 0;
        const openingType = openingBalanceType || 'debit';

        // If outstanding balance is provided, use it; otherwise default to opening balance
        const outstandingValue = outstandingBalance !== undefined ? outstandingBalance : openingValue;
        const outstandingType = outstandingBalanceType !== undefined ? outstandingBalanceType : openingType;

        const ledgerData = {
            name,
            group,
            openingBalance: openingValue,
            openingBalanceType: openingType,
            outstandingBalance: outstandingValue,
            outstandingBalanceType: outstandingType,
            createdBy: req.user._id,
            updatedBy: req.user._id
        };

        const ledger = new Ledger(ledgerData);
        await ledger.save();

        const populatedLedger = await Ledger.findById(ledger._id)
            .populate('group', 'name type slug')
            .populate('vendor', 'vendorName email contactNumber')
            .populate('customer', 'shopName contact')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');

        successResponse(res, "New ledger added", 201, populatedLedger);
    } catch (error) {
        next(error);
    }
};

export const getLedgers = async (req, res, next) => {
    try {
        const { group, ledgerType } = req.query;
        const query = { isActive: true };

        if (group) {
            query.group = group;
        }
        if (ledgerType) {
            query.ledgerType = ledgerType;
        }

        const ledgers = await Ledger.find(query)
            .populate('group', 'name type slug')
            .populate('vendor', 'vendorName email contactNumber')
            .populate('customer', 'shopName contact')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name')
            .sort({ name: 1 });

        successResponse(res, "Ledgers retrieved successfully", 200, ledgers);
    } catch (error) {
        next(error);
    }
};

export const getLedgerById = async (req, res, next) => {
    const { id } = req.params;
    try {
        const ledger = await Ledger.findOne({ _id: id, isActive: true })
            .populate('group', 'name type slug')
            .populate('vendor', 'vendorName email contactNumber')
            .populate('customer', 'shopName contact')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');

        if (!ledger) {
            throw new AppError('Ledger not found', 404);
        }

        successResponse(res, "Ledger retrieved successfully", 200, ledger);
    } catch (error) {
        next(error);
    }
};

export const getLedgersByGroup = async (req, res, next) => {
    const { groupId } = req.params;
    try {
        // Validate group exists
        const group = await Group.findById(groupId);
        if (!group || !group.isActive) {
            throw new AppError('Group not found or inactive', 404);
        }

        const ledgers = await Ledger.find({ group: groupId, isActive: true })
            .populate('group', 'name type slug')
            .populate('vendor', 'vendorName email contactNumber')
            .populate('customer', 'shopName contact')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name')
            .sort({ name: 1 });

        successResponse(res, "Ledgers retrieved successfully", 200, ledgers);
    } catch (error) {
        next(error);
    }
};

export const updateLedger = async (req, res, next) => {
    const { id } = req.params;
    try {
        const { name, group, openingBalance, openingBalanceType, outstandingBalance, outstandingBalanceType } = req.body;

        const ledger = await Ledger.findById(id);
        if (!ledger || !ledger.isActive) {
            throw new AppError('Ledger not found', 404);
        }

        // Validate required fields
        if (!name) {
            throw new AppError('Ledger name is required', 400);
        }

        // Validate group if changed
        if (group) {
            const groupDoc = await Group.findById(group);
            if (!groupDoc || !groupDoc.isActive) {
                throw new AppError('Group not found or inactive', 404);
            }
        }

        // Check if opening balance is being changed
        const isOpeningBalanceChanged = openingBalance !== undefined || openingBalanceType !== undefined;

        let newOutstandingBalance = outstandingBalance !== undefined ? outstandingBalance : ledger.outstandingBalance;
        let newOutstandingBalanceType = outstandingBalanceType !== undefined ? outstandingBalanceType : ledger.outstandingBalanceType;

        // If opening balance changed, sync outstanding balance
        if (isOpeningBalanceChanged) {
            const newOpeningAmount = openingBalance !== undefined ? openingBalance : ledger.openingBalance;
            const newOpeningType = openingBalanceType !== undefined ? openingBalanceType : ledger.openingBalanceType;

            const syncedBalance = syncOutstandingBalance(
                ledger.openingBalance,
                ledger.openingBalanceType,
                newOpeningAmount,
                newOpeningType,
                ledger.outstandingBalance,
                ledger.outstandingBalanceType
            );

            newOutstandingBalance = syncedBalance.amount;
            newOutstandingBalanceType = syncedBalance.type;
        }

        const updateData = {
            name,
            group: group || ledger.group,
            openingBalance: openingBalance !== undefined ? openingBalance : ledger.openingBalance,
            openingBalanceType: openingBalanceType !== undefined ? openingBalanceType : ledger.openingBalanceType,
            outstandingBalance: newOutstandingBalance,
            outstandingBalanceType: newOutstandingBalanceType,
            updatedBy: req.user._id
        };

        const updatedLedger = await Ledger.findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
            .populate('group', 'name type slug')
            .populate('vendor', 'vendorName email contactNumber')
            .populate('customer', 'shopName contact')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');

        successResponse(res, "Ledger updated successfully", 200, updatedLedger);
    } catch (error) {
        next(error);
    }
};

export const deleteLedger = async (req, res, next) => {
    const { id } = req.params;
    try {
        const ledger = await Ledger.findById(id);
        if (!ledger || !ledger.isActive) {
            throw new AppError('Ledger not found', 404);
        }

        // Soft delete
        const deletedLedger = await Ledger.findByIdAndUpdate(
            id,
            { isActive: false, updatedBy: req.user._id },
            { new: true }
        );

        successResponse(res, "Ledger deleted successfully", 200, deletedLedger);
    } catch (error) {
        next(error);
    }
};

export const getMonthlySummary = async (req, res, next) => {
    const { id } = req.params;
    const { type, year } = req.query;

    try {
        let subject = null;
        let subjectType = type;

        if (!subjectType) {
            subject = await Customer.findById(id);
            if (subject) subjectType = 'customer';
            else {
                subject = await Vendor.findById(id);
                if (subject) subjectType = 'vendor';
                else {
                    subject = await Ledger.findById(id);
                    if (subject) subjectType = 'ledger';
                    else {
                        subject = await DieselStation.findById(id);
                        if (subject) subjectType = 'dieselStation';
                    }
                }
            }
        } else {
            if (subjectType === 'customer') subject = await Customer.findById(id);
            else if (subjectType === 'vendor') subject = await Vendor.findById(id);
            else if (subjectType === 'ledger') subject = await Ledger.findById(id);
            else if (subjectType === 'dieselStation') subject = await DieselStation.findById(id);
        }

        if (!subject) {
            throw new AppError('Subject not found', 404);
        }

        let startYear;
        if (year) {
            startYear = parseInt(year);
        } else {
            const today = new Date();
            startYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
        }

        const startDate = new Date(startYear, 3, 1); // Apr 1
        const endDate = new Date(startYear + 1, 3, 1); // Apr 1 next year (exclusive)

        const months = [];
        for (let i = 0; i < 12; i++) {
            const mStart = new Date(startYear, 3 + i, 1);
            const mEnd = new Date(startYear, 3 + i + 1, 1);
            months.push({
                name: mStart.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
                monthShort: mStart.toLocaleString('en-US', { month: 'short', year: '2-digit' }),
                startDate: mStart,
                endDate: mEnd,
                debit: 0,
                credit: 0,
                birds: 0,
                weight: 0,
                volume: 0,
                discountAndOther: 0
            });
        }

        // Fetch Data
        // Valid Date Query or No Date Query
        // Fetch Data: Fetching ALL transactions to enable accurate Forward Calculation from openingBalance
        const voucherQuery = { isActive: true };
        const tripQueryObj = {};
        // Date filters removed manually to allow gapBeforeDebit counting


        let vouchers = await Voucher.find(voucherQuery).lean();

        let trips = [];
        let tripQuery = { ...tripQueryObj };
        if (subjectType === 'customer') tripQuery['sales.client'] = id;
        else if (subjectType === 'vendor') tripQuery['purchases.supplier'] = id;
        else if (subjectType === 'ledger') {
            tripQuery.$or = [
                { 'sales.cashLedger': id },
                { 'sales.onlineLedger': id }
            ];
        } else if (subjectType === 'dieselStation') {
            tripQuery['diesel.stations.dieselStation'] = id;
        }

        // Only fetch if subjectType is known (it should be)
        if (subjectType) trips = await Trip.find(tripQuery).lean();

        let stocks = [];
        // Stocks not relevant for Diesel Station currently
        if (subjectType !== 'dieselStation') {
            let stockQuery = {};

            if (subjectType === 'vendor') stockQuery.vendorId = id;
            else if (subjectType === 'customer') stockQuery.customerId = id;
            else if (subjectType === 'ledger') {
                stockQuery.$or = [
                    { cashLedgerId: id },
                    { onlineLedgerId: id },
                    { expenseLedgerId: id }
                ];
            }
            stocks = await InventoryStock.find(stockQuery).lean();
        }

        let indirectSales = [];
        // Indirect Sales not relevant for Diesel Station currently
        if (subjectType !== 'dieselStation') {
            let indirectQuery = {};

            if (subjectType === 'customer') indirectQuery.customer = id;
            else if (subjectType === 'vendor') indirectQuery.vendor = id;
            else indirectQuery = null;

            if (indirectQuery) indirectSales = await IndirectSale.find(indirectQuery).lean();
        }

        const subjectIdStr = id.toString();
        const subjectName = subjectType === 'customer' ? (subject.shopName || subject.ownerName) :
            subjectType === 'vendor' ? subject.vendorName : subject.name;
        const subjectNameStr = subjectName ? subjectName.trim().toLowerCase() : '';

        // Helper
        let gapDebit = 0;
        let gapCredit = 0;
        let gapBeforeDebit = 0;
        let gapBeforeCredit = 0;

        const addToStats = (date, debit, credit, birds = 0, weight = 0, volume = 0, discount = 0, isDiscountRelated = false) => {
            if (date >= endDate) {
                gapDebit += debit;
                gapCredit += credit;
                return;
            }
            if (date < startDate) {
                gapBeforeDebit += debit;
                gapBeforeCredit += credit;
                return;
            }

            const idx = months.findIndex(m => date >= m.startDate && date < m.endDate);
            if (idx !== -1) {
                months[idx].debit += debit;
                months[idx].credit += credit;
                months[idx].birds += birds;
                months[idx].weight += weight;
                months[idx].volume += volume;
                if (isDiscountRelated) months[idx].discountAndOther += discount;
            }
        };

        // Process Vouchers
        for (const v of vouchers) {
            const vDate = new Date(v.date);
            let debit = 0;
            let credit = 0;
            let voucherAmount = 0;
            let isMatch = false;

            // Entries
            if (v.entries) {
                v.entries.forEach(e => {
                    let entryMatch = false;
                    const entryAcc = e.account ? e.account.toString().trim().toLowerCase() : '';
                    if (entryAcc === subjectIdStr || entryAcc === subjectNameStr) entryMatch = true;

                    if (entryMatch) {
                        debit += e.debitAmount || 0;
                        credit += e.creditAmount || 0;
                        voucherAmount += (e.debitAmount || 0) + (e.creditAmount || 0);
                        isMatch = true;
                    }
                });
            }

            // Parties
            if ((v.voucherType === 'Payment' || v.voucherType === 'Receipt') && v.parties) {
                v.parties.forEach(p => {
                    if (p.partyId && p.partyId.toString() === subjectIdStr) {
                        let isTypeMatch = false;
                        if (subjectType === 'ledger' && p.partyType === 'ledger') isTypeMatch = true;
                        else if (subjectType === 'customer' && p.partyType === 'customer') isTypeMatch = true;
                        else if (subjectType === 'vendor' && p.partyType === 'vendor') isTypeMatch = true;
                        else if (subjectType === 'dieselStation' && (!p.partyType || p.partyType === 'dieselStation')) isTypeMatch = true;

                        if (isTypeMatch) {
                            if (v.voucherType === 'Payment') debit += p.amount || 0;
                            else credit += p.amount || 0;
                            voucherAmount += p.amount || 0;
                            isMatch = true;
                        }
                    }
                });
            }

            // Account Header (Ledger)
            if (subjectType === 'ledger' && (v.voucherType === 'Payment' || v.voucherType === 'Receipt') && v.account) {
                if (v.account.toString() === subjectIdStr) {
                    const totalAmount = v.parties ? v.parties.reduce((sum, p) => sum + (p.amount || 0), 0) : 0;
                    if (v.voucherType === 'Payment') credit += totalAmount;
                    else debit += totalAmount;
                    voucherAmount += totalAmount;
                    isMatch = true;
                }
            }

            if (isMatch) {
                let isDiscount = false;
                if (subjectType === 'customer') {
                    if (v.voucherType !== 'Receipt' && v.voucherType !== 'Payment') isDiscount = true;
                } else if (subjectType === 'vendor') {
                    if (v.voucherType === 'Receipt' || v.voucherType === 'Journal') isDiscount = true;
                }

                addToStats(vDate, debit, credit, 0, 0, 0, isDiscount ? voucherAmount : 0, isDiscount);
            }
        }

        // Process Trips
        for (const t of trips) {
            const tDate = new Date(t.createdAt);
            let debit = 0; let credit = 0; let birds = 0; let weight = 0; let volume = 0; let discount = 0; let isMatch = false;

            if (subjectType === 'customer') {
                if (t.sales) {
                    t.sales.forEach(s => {
                        if (s.client && s.client.toString() === id.toString()) {
                            debit += s.amount || 0;
                            credit += (s.cashPaid || 0) + (s.onlinePaid || 0) + (s.discount || 0);
                            birds += (s.birds || s.birdsCount || 0);
                            weight += s.weight || 0;
                            discount += s.discount || 0;
                            isMatch = true;
                        }
                    });
                }
            } else if (subjectType === 'vendor') {
                if (t.purchases) {
                    t.purchases.forEach(p => {
                        if (p.supplier && p.supplier.toString() === id.toString()) {
                            credit += p.amount || 0;
                            birds += p.birds || 0;
                            weight += p.weight || 0;
                            isMatch = true;
                        }
                    });
                }
            } else if (subjectType === 'ledger') {
                if (t.sales) {
                    t.sales.forEach(s => {
                        if (s.cashLedger && s.cashLedger.toString() === id.toString()) {
                            debit += s.cashPaid || 0; isMatch = true;
                        }
                        if (s.onlineLedger && s.onlineLedger.toString() === id.toString()) {
                            debit += s.onlinePaid || 0; isMatch = true;
                        }
                    });
                }
            } else if (subjectType === 'dieselStation') {
                if (t.diesel && t.diesel.stations) {
                    t.diesel.stations.forEach(s => {
                        if (s.dieselStation && s.dieselStation.toString() === id.toString()) {
                            credit += s.amount || 0; // Purchase for Station is Credit (Liability Increase)
                            volume += s.volume || 0;
                            isMatch = true;
                        }
                    });
                }
            }
            if (isMatch) addToStats(tDate, debit, credit, birds, weight, volume, discount, true);
        }

        // Process Stocks
        for (const s of stocks) {
            const sDate = new Date(s.date);
            let debit = 0; let credit = 0; let birds = 0; let weight = 0; let discount = 0; let isMatch = false;

            if (subjectType === 'customer') {
                if (s.customerId && s.customerId.toString() === id.toString()) {
                    if (s.type === 'sale' || s.type === 'receipt') {
                        if (s.type === 'sale') {
                            debit += s.amount || 0;
                            birds += s.birds || 0;
                            weight += s.weight || 0;
                        }
                        credit += (s.cashPaid || 0) + (s.onlinePaid || 0) + (s.discount || 0);
                        discount += s.discount || 0;
                        isMatch = true;
                    }
                }
            } else if (subjectType === 'vendor') {
                const sVendorId = s.vendorId?._id || s.vendorId;
                if (sVendorId && sVendorId.toString() === id.toString()) {
                    if (s.type === 'purchase' || s.type === 'opening') {
                        credit += s.amount || 0;
                        birds += s.birds || 0;
                        weight += s.weight || 0;
                        isMatch = true;
                    }
                }
            } else if (subjectType === 'ledger') {
                if (s.cashLedgerId && s.cashLedgerId.toString() === id.toString()) { debit += s.cashPaid || 0; isMatch = true; }
                if (s.onlineLedgerId && s.onlineLedgerId.toString() === id.toString()) { debit += s.onlinePaid || 0; isMatch = true; }
                if (s.expenseLedgerId && s.expenseLedgerId.toString() === id.toString()) { debit += s.amount || 0; isMatch = true; }
            }

            if (isMatch) addToStats(sDate, debit, credit, birds, weight, 0, discount, true);
        }

        // Process Indirect Sales
        for (const s of indirectSales) {
            const sDate = new Date(s.date);
            let debit = 0; let credit = 0; let birds = 0; let weight = 0; let isMatch = false;

            if (subjectType === 'customer') {
                debit += s.sales?.amount || 0;
                birds += s.sales?.birds || 0;
                weight += s.sales?.weight || 0;
                isMatch = true;
            } else if (subjectType === 'vendor') {
                credit += s.summary?.totalPurchaseAmount || 0;
                birds += s.summary?.totalPurchaseBirds || 0;
                weight += s.summary?.totalPurchaseWeight || 0;
                isMatch = true;
            }
            if (isMatch) addToStats(sDate, debit, credit, birds, weight, 0, 0, false);
        }


        // Calculate Balances natively from Opening fields via Forward Calculation
        // Use standard balance utils which handles this via type

        // Forward Calculation
        // Use original opening balance + transactions BEFORE start date
        const origOpenSigned = toSignedValue(subject.openingBalance || 0, subject.openingBalanceType || 'debit');
        const netBefore = gapBeforeDebit - gapBeforeCredit;
        let yearStartBalanceSigned = origOpenSigned + netBefore;

        let currentSigned = yearStartBalanceSigned;
        const finalMonths = months.map(m => {
            currentSigned += (m.debit - m.credit);
            const closing = fromSignedValue(currentSigned);
            return {
                ...m,
                closingBalance: closing.amount,
                closingBalanceType: closing.type,
                startDate: m.startDate.toISOString(),
                endDate: m.endDate.toISOString()
            };
        });

        const openingYearBalance = fromSignedValue(yearStartBalanceSigned);

        successResponse(res, "Monthly summary retrieved", 200, {
            subject: {
                id: subject._id,
                name: subject.name || subject.shopName || subject.vendorName,
                type: subjectType
            },
            openingBalance: openingYearBalance.amount,
            openingBalanceType: openingYearBalance.type,
            months: finalMonths,
            totals: {
                debit: months.reduce((acc, m) => acc + m.debit, 0),
                credit: months.reduce((acc, m) => acc + m.credit, 0),
                birds: months.reduce((acc, m) => acc + m.birds, 0),
                weight: months.reduce((acc, m) => acc + m.weight, 0),
                volume: months.reduce((acc, m) => acc + m.volume, 0),
                discountAndOther: months.reduce((acc, m) => acc + m.discountAndOther, 0)
            }
        });

    } catch (error) {
        next(error);
    }
};


export const getDailySummary = async (req, res, next) => {
    const { id } = req.params;
    const { type, year, month } = req.query;

    try {
        let subject = null;
        let subjectType = type;

        if (!subjectType) {
            subject = await Customer.findById(id);
            if (subject) subjectType = 'customer';
            else {
                subject = await Vendor.findById(id);
                if (subject) subjectType = 'vendor';
                else {
                    subject = await Ledger.findById(id);
                    if (subject) subjectType = 'ledger';
                    else {
                        subject = await DieselStation.findById(id);
                        if (subject) subjectType = 'dieselStation';
                    }
                }
            }
        } else {
            if (subjectType === 'customer') subject = await Customer.findById(id);
            else if (subjectType === 'vendor') subject = await Vendor.findById(id);
            else if (subjectType === 'ledger') subject = await Ledger.findById(id);
            else if (subjectType === 'dieselStation') subject = await DieselStation.findById(id);
        }

        if (!subject) {
            throw new AppError('Subject not found', 404);
        }

        const today = new Date();
        const targetYear = year ? parseInt(year) : today.getFullYear();
        // Month 1-12 from query, convert to 0-11. Default to current month.
        const targetMonth = month ? parseInt(month) - 1 : today.getMonth();

        const startDate = new Date(targetYear, targetMonth, 1);
        const endDate = new Date(targetYear, targetMonth + 1, 1);

        const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
        const days = [];
        for (let i = 1; i <= daysInMonth; i++) {
            const dCurrent = new Date(targetYear, targetMonth, i);
            days.push({
                day: i,
                date: dCurrent.toLocaleDateString('en-CA'), // YYYY-MM-DD
                displayDate: dCurrent.toLocaleDateString('en-GB'), // DD/MM/YYYY
                debit: 0,
                credit: 0,
                voucherCount: 0
            });
        }

        let vouchers = await Voucher.find({
            isActive: true,
            date: { $gte: startDate, $lt: endDate }
        }).lean();

        let trips = [];
        // Only fetch trips for relevant period
        const tripQuery = { createdAt: { $gte: startDate, $lt: endDate } };

        if (subjectType === 'customer') {
            tripQuery['sales.client'] = id;
            trips = await Trip.find(tripQuery).lean();
        } else if (subjectType === 'vendor') {
            tripQuery['purchases.supplier'] = id;
            trips = await Trip.find(tripQuery).lean();
        } else if (subjectType === 'ledger') {
            tripQuery.$or = [
                { 'sales.cashLedger': id },
                { 'sales.onlineLedger': id }
            ];
            trips = await Trip.find(tripQuery).lean();
        } else if (subjectType === 'dieselStation') {
            tripQuery['diesel.stations.dieselStation'] = id;
            trips = await Trip.find(tripQuery).lean();
        }

        const subjectIdStr = id.toString();
        const subjectName = subjectType === 'customer' ? (subject.shopName || subject.ownerName) :
            subjectType === 'vendor' ? subject.vendorName : subject.name;
        const subjectNameStr = subjectName ? subjectName.trim().toLowerCase() : '';

        // Process Vouchers
        vouchers.forEach(v => {
            let debit = 0;
            let credit = 0;
            let isMatch = false;

            const vDate = new Date(v.date);
            const dayOfMonth = vDate.getDate(); // 1-31
            const dayIndex = dayOfMonth - 1;

            if (dayIndex < 0 || dayIndex >= days.length) return; // Should not happen given query

            // 1. Check entries
            if (v.entries) {
                v.entries.forEach(e => {
                    let entryMatch = false;
                    const entryAcc = e.account ? e.account.toString().trim().toLowerCase() : '';

                    if (entryAcc === subjectIdStr || entryAcc === subjectNameStr) {
                        entryMatch = true;
                    }
                    if (!entryMatch && e.name && e.name.trim().toLowerCase() === subjectNameStr) {
                        entryMatch = true;
                    }

                    if (entryMatch) {
                        debit += e.debitAmount || 0;
                        credit += e.creditAmount || 0;
                        isMatch = true;
                    }
                });
            }

            // 2. Check Parties (Payment/Receipt)
            if ((v.voucherType === 'Payment' || v.voucherType === 'Receipt') && v.parties) {
                v.parties.forEach(p => {
                    if (p.partyId && p.partyId.toString() === subjectIdStr) {
                        let isTypeMatch = false;
                        if (subjectType === 'ledger' && p.partyType === 'ledger') isTypeMatch = true;
                        else if (subjectType === 'customer' && p.partyType === 'customer') isTypeMatch = true;
                        else if (subjectType === 'vendor' && p.partyType === 'vendor') isTypeMatch = true;
                        else if (subjectType === 'dieselStation' && (!p.partyType || p.partyType === 'dieselStation')) isTypeMatch = true;

                        if (isTypeMatch) {
                            if (v.voucherType === 'Payment') {
                                debit += p.amount || 0;
                            } else {
                                credit += p.amount || 0;
                            }
                            isMatch = true;
                        }
                    }
                });
            }

            // 3. Check Account Header (For Ledgers - Payment/Receipt)
            if (subjectType === 'ledger' && (v.voucherType === 'Payment' || v.voucherType === 'Receipt') && v.account) {
                if (v.account.toString() === subjectIdStr) {
                    const totalAmount = v.parties ? v.parties.reduce((sum, p) => sum + (p.amount || 0), 0) : 0;
                    if (v.voucherType === 'Payment') {
                        credit += totalAmount;
                    } else {
                        debit += totalAmount;
                    }
                    isMatch = true;
                }
            }

            if (isMatch) {
                days[dayIndex].debit += debit;
                days[dayIndex].credit += credit;
                days[dayIndex].voucherCount += 1;
            }
        });

        // Process Trips
        trips.forEach(t => {
            let debit = 0;
            let credit = 0;
            let isMatch = false;

            const tDate = new Date(t.createdAt);
            const dayOfMonth = tDate.getDate();
            const dayIndex = dayOfMonth - 1;

            if (dayIndex < 0 || dayIndex >= days.length) return;

            if (subjectType === 'customer') {
                t.sales.forEach(s => {
                    if (s.client && s.client.toString() === id.toString() && !s.isReceipt) {
                        debit += s.amount || 0;
                        credit += (s.cashPaid || 0) + (s.onlinePaid || 0) + (s.discount || 0);
                        isMatch = true;
                    }
                });
            } else if (subjectType === 'vendor') {
                t.purchases.forEach(p => {
                    if (p.supplier && p.supplier.toString() === id.toString()) {
                        credit += p.amount || 0;
                        isMatch = true;
                    }
                });
            } else if (subjectType === 'ledger') {
                if (t.sales) {
                    t.sales.forEach(s => {
                        let localDebit = 0;
                        if (s.cashLedger && s.cashLedger.toString() === id.toString()) {
                            localDebit += s.cashPaid || 0;
                        }
                        if (s.onlineLedger && s.onlineLedger.toString() === id.toString()) {
                            localDebit += s.onlinePaid || 0;
                        }
                        if (localDebit > 0) {
                            debit += localDebit;
                            isMatch = true;
                        }
                    });
                }
            } else if (subjectType === 'dieselStation') {
                if (t.diesel && t.diesel.stations) {
                    t.diesel.stations.forEach(s => {
                        if (s.dieselStation && s.dieselStation.toString() === id.toString()) {
                            credit += s.amount || 0;
                            isMatch = true;
                        }
                    });
                }
            }

            if (isMatch) {
                days[dayIndex].debit += debit;
                days[dayIndex].credit += credit;
                days[dayIndex].voucherCount += 1; // Count trip as one transaction entry source
            }
        });

        const totals = {
            debit: days.reduce((acc, d) => acc + d.debit, 0),
            credit: days.reduce((acc, d) => acc + d.credit, 0),
            voucherCount: days.reduce((acc, d) => acc + d.voucherCount, 0)
        };

        successResponse(res, "Daily summary retrieved", 200, {
            subject: {
                id: subject._id,
                name: subject.name || subject.shopName || subject.vendorName,
                type: subjectType
            },
            days,
            totals,
            year: targetYear,
            month: targetMonth + 1
        });

    } catch (error) {
        next(error);
    }
};

export const getLedgerTransactions = async (req, res, next) => {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    try {
        const ledger = await Ledger.findById(id);
        if (!ledger) {
            throw new AppError('Ledger not found', 404);
        }

        const queryStartDate = startDate ? new Date(startDate) : null;
        let queryEndDate = endDate ? new Date(endDate) : null;

        // Adjust endDate to end of day if provided
        if (queryEndDate) {
            queryEndDate.setHours(23, 59, 59, 999);
        }

        // Vouchers Query
        const voucherQuery = {
            isActive: true,
            $or: [
                { 'entries.account': ledger.name }, // For Journal/Contra (using Name string)
                { account: id },                    // For Payment/Receipt Header (using ObjectId)
                { 'parties.partyId': id }           // For Payment/Receipt Line Items (using ObjectId)
            ]
        };

        if (queryStartDate || queryEndDate) {
            voucherQuery.date = {};
            if (queryStartDate) voucherQuery.date.$gte = queryStartDate;
            if (queryEndDate) voucherQuery.date.$lte = queryEndDate;
        }

        // Trips Query (for Cash/Bank ledgers used in Sales)
        const tripQuery = {
            $or: [
                { 'sales.cashLedger': id },
                { 'sales.onlineLedger': id }
            ]
        };
        // Date filter for trips usually uses 'date'
        if (queryStartDate || queryEndDate) {
            tripQuery.date = {};
            if (queryStartDate) tripQuery.date.$gte = queryStartDate;
            if (queryEndDate) tripQuery.date.$lte = queryEndDate;
        }

        // Inventory Stock Query
        const stockQuery = {
            $or: [
                { 'cashLedgerId': id },
                { 'onlineLedgerId': id },
                { 'expenseLedgerId': id }
            ]
        };
        if (queryStartDate || queryEndDate) {
            stockQuery.date = {};
            if (queryStartDate) stockQuery.date.$gte = queryStartDate;
            if (queryEndDate) stockQuery.date.$lte = queryEndDate;
        }

        const [vouchers, trips, stocks] = await Promise.all([
            Voucher.find(voucherQuery).lean()
                .populate('party', 'shopName vendorName')
                .populate('parties.partyId', 'shopName vendorName name') // Populate name for Ledger parties too
                .populate('account', 'name'), // Populate header Account to get its name
            Trip.find(tripQuery).lean().populate('vehicle', 'registrationNumber').populate('supervisor', 'name'),
            InventoryStock.find(stockQuery).lean().populate('customerId', 'shopName ownerName')
        ]);

        let transactions = [];

        // Process Vouchers
        vouchers.forEach(v => {
            let debit = 0;
            let credit = 0;
            let description = v.narration || v.voucherType;
            let refNo = v.voucherNumber;

            // Determine Debit/Credit for this ledger
            if (v.voucherType === 'Payment' || v.voucherType === 'Receipt') {
                // If ledger is the ACCOUNT (Header)
                // e.g. Payment made FROM Cash (this ledger) TO Vendor
                if (v.account && v.account.toString() === id.toString()) {
                    const totalAmount = v.parties.reduce((sum, p) => sum + (p.amount || 0), 0);
                    if (v.voucherType === 'Payment') {
                        credit += totalAmount;
                    } else {
                        debit += totalAmount;
                    }

                    // For Cash/Bank Ledger (Account), the "Particulars" should be the Party Name (Vendor/Expense)
                    if (v.parties && v.parties.length > 0) {
                        const firstParty = v.parties[0].partyId; // This is populated object
                        if (v.parties.length === 1 && firstParty) {
                            // Use shopName for customer, vendorName for vendor, name for ledger
                            description = firstParty.shopName || firstParty.vendorName || firstParty.name || 'Unknown Party';
                        } else {
                            description = `Multiple Accounts (${v.parties.length})`;
                        }
                    } else {
                        description = v.voucherType; // Fallback
                    }
                }

                // If ledger is in PARTIES (Line Items)
                // e.g. Payment made TO Vendor (this ledger) FROM Cash
                if (v.parties) {
                    v.parties.forEach(p => {
                        if (p.partyId && p.partyId._id && p.partyId._id.toString() === id.toString()) {
                            if (v.voucherType === 'Payment') {
                                debit += p.amount || 0;
                            } else {
                                credit += p.amount || 0;
                            }

                            // For Vendor/Expense Ledger (Party), the "Particulars" should be the Source Account (Cash/Bank)
                            if (!v.account || v.account.toString() !== id.toString()) {
                                // Use header account name as description
                                // v.account is now populated
                                description = v.account ? v.account.name : 'Unknown Account';
                            }
                        }
                    });
                }
            } else {
                // Contra / Journal
                v.entries.forEach(e => {
                    if (e.account && e.account.toLowerCase() === ledger.name.toLowerCase()) {
                        debit += e.debitAmount || 0;
                        credit += e.creditAmount || 0;

                        if (v.voucherType === 'Journal') {
                            let oppositeAccountName = '';
                            if (e.debitAmount > 0) {
                                const crEntry = v.entries.find(entry => entry.creditAmount > 0 && entry.account && entry.account.toLowerCase() !== ledger.name.toLowerCase());
                                if (crEntry) oppositeAccountName = crEntry.account;
                            } else if (e.creditAmount > 0) {
                                const drEntry = v.entries.find(entry => entry.debitAmount > 0 && entry.account && entry.account.toLowerCase() !== ledger.name.toLowerCase());
                                if (drEntry) oppositeAccountName = drEntry.account;
                            }

                            if (oppositeAccountName) {
                                description = oppositeAccountName;
                            }
                        }
                    }
                });
            }

            if (debit > 0 || credit > 0) {
                transactions.push({
                    _id: v._id,
                    date: v.date,
                    type: v.voucherType,
                    refNo: `VCH-${refNo}`,
                    description,
                    debit,
                    credit,
                    source: 'voucher',
                    narration: v.narration || ''
                });
            }
        });

        // Process Trips
        trips.forEach(t => {
            if (t.sales) {
                t.sales.forEach(s => {
                    let debit = 0;
                    let credit = 0;
                    let isRelevant = false;

                    if (s.cashLedger && s.cashLedger.toString() === id.toString()) {
                        debit += s.cashPaid || 0;
                        isRelevant = true;
                    }
                    if (s.onlineLedger && s.onlineLedger.toString() === id.toString()) {
                        debit += s.onlinePaid || 0;
                        isRelevant = true;
                    }

                    if (isRelevant && (debit > 0)) {
                        transactions.push({
                            _id: t._id,
                            date: t.date,
                            type: 'Receipt',
                            refNo: t.tripId,
                            description: `Trip Bill: ${s.billNumber} (${s.birds} birds) - ${s.product || 'Bird Sale'}`,
                            debit,
                            credit,
                            source: 'trip'
                        });
                    }
                });
            }

        });

        // Process Inventory Stocks (Sales/Receipts)
        stocks.forEach(s => {
            let debit = 0;
            let credit = 0;
            let isRelevant = false;

            // Cash Payment
            if (s.cashLedgerId && s.cashLedgerId.toString() === id.toString()) {
                debit += s.cashPaid || 0;
                isRelevant = true;
            }

            // Online Payment
            if (s.onlineLedgerId && s.onlineLedgerId.toString() === id.toString()) {
                debit += s.onlinePaid || 0;
                isRelevant = true;
            }

            // Expense (Feed Consume, etc.)
            if (s.expenseLedgerId && s.expenseLedgerId.toString() === id.toString()) {
                debit += s.amount || 0; // Usage is an expense (Debit)
                isRelevant = true;
            }

            if (isRelevant && (debit > 0)) {
                transactions.push({
                    _id: s._id,
                    date: s.date,
                    type: s.type === 'receipt' ? 'Receipt' : s.type === 'sale' ? 'Receipt' : 'Stock Sale',
                    refNo: s.billNumber || s.refNo || '-',
                    description: s.type === 'receipt'
                        ? `STOCK_RECEIPT_BILL - ${s.customerId?.shopName || s.customerId?.ownerName || 'Customer'}`
                        : s.type === 'consume'
                            ? `FEED CONSUMPTION`
                            : `STOCK_BILL - ${s.customerId?.shopName || s.customerId?.ownerName || 'Customer'} (${s.birds || 0} birds)`,
                    debit,
                    credit,
                    source: 'stock'
                });
            }
        });

        // Calculate Opening Balance if StartDate is present
        // Use Ledger's opening balance + sum of all previous transactions

        let openingBalance = ledger.openingBalance || 0;
        let openingType = ledger.openingBalanceType || 'debit';
        let signedOpening = toSignedValue(openingBalance, openingType);

        if (queryStartDate) {
            // Find transactions BEFORE queryStartDate
            const preVoucherQuery = {
                isActive: true,
                date: { $lt: queryStartDate },
                $or: [
                    { 'entries.account': ledger.name },
                    { account: id },
                    { 'parties.partyId': id }
                ]
            };
            const preTripQuery = {
                date: { $lt: queryStartDate },
                $or: [
                    { 'sales.cashLedger': id },
                    { 'sales.onlineLedger': id }
                ]
            };

            const stackQuery = {
                date: { $lt: queryStartDate },
                $or: [
                    { 'cashLedgerId': id },
                    { 'onlineLedgerId': id },
                    { 'expenseLedgerId': id }
                ]
            };

            const [preVouchers, preTrips, preStocks] = await Promise.all([
                Voucher.find(preVoucherQuery).lean().select('voucherType date account parties entries'),
                Trip.find(preTripQuery).lean().select('sales date'),
                InventoryStock.find(stackQuery).lean().select('cashLedgerId onlineLedgerId cashPaid onlinePaid type')
            ]);

            preVouchers.forEach(v => {
                let debit = 0;
                let credit = 0;
                if (v.voucherType === 'Payment' || v.voucherType === 'Receipt') {
                    if (v.account && v.account.toString() === id.toString()) {
                        const total = v.parties.reduce((s, p) => s + (p.amount || 0), 0);
                        if (v.voucherType === 'Payment') credit += total;
                        else debit += total;
                    }
                    if (v.parties) {
                        v.parties.forEach(p => {
                            if (p.partyId && p.partyId.toString() === id.toString()) {
                                if (v.voucherType === 'Payment') debit += p.amount || 0;
                                else credit += p.amount || 0;
                            }
                        });
                    }
                } else {
                    v.entries.forEach(e => {
                        if (e.account && e.account.toLowerCase() === ledger.name.toLowerCase()) {
                            debit += e.debitAmount || 0;
                            credit += e.creditAmount || 0;
                        }
                    });
                }
                signedOpening += (debit - credit);
            });

            preTrips.forEach(t => {
                if (t.sales) {
                    t.sales.forEach(s => {
                        let debit = 0;
                        if (s.cashLedger && s.cashLedger.toString() === id.toString()) debit += s.cashPaid || 0;
                        if (s.onlineLedger && s.onlineLedger.toString() === id.toString()) debit += s.onlinePaid || 0;
                        signedOpening += debit;
                    });
                }
            });

            preStocks.forEach(s => {
                let debit = 0;
                if (s.cashLedgerId && s.cashLedgerId.toString() === id.toString()) debit += s.cashPaid || 0;
                if (s.onlineLedgerId && s.onlineLedgerId.toString() === id.toString()) debit += s.onlinePaid || 0;
                if (s.expenseLedgerId && s.expenseLedgerId.toString() === id.toString()) debit += s.amount || 0; // Expense is Debit
                signedOpening += debit; // Sales/Receipts receiving money into Cash/Bank are debits. Expenses are Debits.
            });
        }

        // Sort transactions
        transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

        // Calculate Running Balance
        let currentBalance = signedOpening;
        transactions = transactions.map(t => {
            currentBalance += (t.debit - t.credit);
            const formatted = fromSignedValue(currentBalance);
            return {
                ...t,
                runningBalance: formatted.amount,
                runningBalanceType: formatted.type
            };
        });

        // Final Opening Balance for Display (at queryStartDate)
        const displayOpening = fromSignedValue(signedOpening);

        // Add Opening Balance Entry
        transactions.unshift({
            _id: 'op_bal',
            date: queryStartDate || ledger.createdAt || new Date(),
            type: 'OPENING',
            refNo: '-',
            description: 'OP',
            debit: 0,
            credit: 0,
            runningBalance: displayOpening.amount,
            runningBalanceType: displayOpening.type
        });

        successResponse(res, "Ledger transactions retrieved", 200, {
            ledger: {
                _id: ledger._id,
                name: ledger.name,
                group: ledger.group
            },
            openingBalance: displayOpening.amount,
            openingBalanceType: displayOpening.type,
            transactions,
            closingBalance: transactions.length > 0 ? transactions[transactions.length - 1].runningBalance : displayOpening.amount,
            closingBalanceType: transactions.length > 0 ? transactions[transactions.length - 1].runningBalanceType : displayOpening.type
        });

    } catch (error) {
        next(error);
    }
};

