import Trip from "../models/Trip.js";
import Group from "../models/Group.js";
import Ledger from "../models/Ledger.js";
import Voucher from "../models/Voucher.js";
import InventoryStock from "../models/InventoryStock.js";
import IndirectSale from "../models/IndirectSale.js";
import AppError from "../utils/AppError.js";
import { successResponse } from "../utils/responseHandler.js";
import mongoose from "mongoose";

// Helper functions (duplicated from balanceSheet.controller.js)
const buildTree = (groups) => {
    const groupMap = new Map();
    const rootGroups = [];
    const getIdString = (id) => {
        if (!id) return null;
        if (typeof id === 'string') return id;
        if (id.toString) return id.toString();
        return String(id);
    };
    groups.forEach(group => {
        const plainGroup = group.toObject ? group.toObject() : group;
        const groupId = getIdString(plainGroup._id || plainGroup.id);
        if (groupId) {
            groupMap.set(groupId, {
                ...plainGroup,
                _id: groupId,
                id: groupId,
                children: [],
                ledgers: []
            });
        }
    });
    groups.forEach(group => {
        const plainGroup = group.toObject ? group.toObject() : group;
        const groupId = getIdString(plainGroup._id || plainGroup.id);
        const node = groupMap.get(groupId);
        if (node) {
            let parentGroupId = null;
            if (plainGroup.parentGroup) {
                if (typeof plainGroup.parentGroup === 'object') {
                    parentGroupId = getIdString(plainGroup.parentGroup._id || plainGroup.parentGroup.id);
                } else {
                    parentGroupId = getIdString(plainGroup.parentGroup);
                }
            }
            if (parentGroupId && groupMap.has(parentGroupId)) {
                const parent = groupMap.get(parentGroupId);
                parent.children.push(node);
            } else {
                rootGroups.push(node);
            }
        }
    });
    return rootGroups;
};

// Helper to merge Periodic Balance into Map
const mergeToBalanceMap = (map, ledgerName, debit = 0, credit = 0) => {
    if (!ledgerName) return;
    const normalizedName = ledgerName.trim().toLowerCase();

    if (!map.has(normalizedName)) {
        map.set(normalizedName, { debitTotal: 0, creditTotal: 0 });
    }
    const entry = map.get(normalizedName);
    entry.debitTotal += debit;
    entry.creditTotal += credit;
};

// Build Period Balance Map (Vouchers + Trips + Stocks)
const buildPeriodBalanceMap = async (startDate, endDate, allLedgers) => {
    try {
        const query = { isActive: true };
        const tripQuery = { isActive: true }; // Assuming trip has isActive or similar, check Trip model but for now assume basics.
        // Actually Trip usually doesn't have isActive, just status. 

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        // 1. Voucher Aggregation (Fastest for massive data)
        const voucherBalances = await Voucher.aggregate([
            { $match: query },
            { $unwind: '$entries' },
            {
                $group: {
                    _id: '$entries.account',
                    debitTotal: { $sum: { $ifNull: ['$entries.debitAmount', 0] } },
                    creditTotal: { $sum: { $ifNull: ['$entries.creditAmount', 0] } }
                }
            }
        ]);

        const map = new Map();
        voucherBalances.forEach(item => {
            if (item._id) {
                const normalizedName = item._id.toString().trim().toLowerCase();
                map.set(normalizedName, {
                    debitTotal: item.debitTotal || 0,
                    creditTotal: item.creditTotal || 0
                });
            }
        });

        // Map ID -> Name for lookups
        const ledgerNameMap = new Map();
        allLedgers.forEach(l => {
            if (l._id && l.name) ledgerNameMap.set(l._id.toString(), l.name);
        });

        // 2. Process Trips (Date filtering on createdAt)
        const tripDateQuery = {};
        if (startDate) tripDateQuery.$gte = new Date(startDate);
        if (endDate) tripDateQuery.$lte = new Date(endDate);

        let tQuery = {};
        if (startDate || endDate) tQuery.createdAt = tripDateQuery;

        const trips = await Trip.find(tQuery).lean();

        trips.forEach(t => {
            if (t.sales) {
                t.sales.forEach(s => {
                    // Cash Sale -> Debit Cash Ledger
                    if (s.cashLedger) {
                        const name = ledgerNameMap.get(s.cashLedger.toString());
                        if (name) mergeToBalanceMap(map, name, s.cashPaid || 0, 0);
                    }
                    // Online Sale -> Debit Bank(Online) Ledger
                    if (s.onlineLedger) {
                        const name = ledgerNameMap.get(s.onlineLedger.toString());
                        if (name) mergeToBalanceMap(map, name, s.onlinePaid || 0, 0);
                    }
                });
            }
        });

        // 3. Process Stocks (Date filtering on date)
        const stockDateQuery = {};
        if (startDate) stockDateQuery.$gte = new Date(startDate);
        if (endDate) stockDateQuery.$lte = new Date(endDate);

        let sQuery = {};
        if (startDate || endDate) sQuery.date = stockDateQuery;

        const stocks = await InventoryStock.find(sQuery).lean();

        stocks.forEach(s => {
            // Expense
            if (s.expenseLedgerId) {
                const name = ledgerNameMap.get(s.expenseLedgerId.toString());
                if (name) mergeToBalanceMap(map, name, s.amount || 0, 0); // Debit Expense
            }

            // Cash/Online Payments/Receipts handling
            // Purchase/Opening -> Credit Cash/Bank
            // Sale/Receipt -> Debit Cash/Bank

            const isCredit = (s.type === 'purchase' || s.type === 'opening');

            if (s.cashLedgerId) {
                const name = ledgerNameMap.get(s.cashLedgerId.toString());
                if (name) {
                    const amt = s.cashPaid || 0;
                    if (isCredit) mergeToBalanceMap(map, name, 0, amt);
                    else mergeToBalanceMap(map, name, amt, 0);
                }
            }

            if (s.onlineLedgerId) {
                const name = ledgerNameMap.get(s.onlineLedgerId.toString());
                if (name) {
                    const amt = s.onlinePaid || 0;
                    if (isCredit) mergeToBalanceMap(map, name, 0, amt);
                    else mergeToBalanceMap(map, name, amt, 0);
                }
            }
        });

        return map;
    } catch (error) {
        console.error('Error building period balance map:', error);
        return new Map();
    }
};

const calculateLedgerBalance = (ledgerName, balanceMap) => {
    try {
        const normalizedName = ledgerName.toString().trim().toLowerCase();
        const balance = balanceMap.get(normalizedName) || { debitTotal: 0, creditTotal: 0 };
        return {
            debitTotal: balance.debitTotal,
            creditTotal: balance.creditTotal,
            balance: balance.debitTotal - balance.creditTotal
        };
    } catch (error) {
        return { debitTotal: 0, creditTotal: 0, balance: 0 };
    }
};

const calculateGroupBalance = async (group, balanceMap, ledgerGroupMap) => {
    let totalBalance = 0;
    let totalDebit = 0;
    let totalCredit = 0;

    const groupId = group.id || group._id;
    const ledgers = ledgerGroupMap.get(groupId.toString()) || [];

    for (const ledger of ledgers) {
        const ledgerBalance = calculateLedgerBalance(ledger.name, balanceMap);
        totalDebit += ledgerBalance.debitTotal;
        totalCredit += ledgerBalance.creditTotal;

        // P&L Logic
        // Income (Credit nature): Credit - Debit (Positive Income means Credit > Debit)
        // Expenses (Debit nature): Debit - Credit (Positive Expense means Debit > Credit)
        if (group.type === 'Income') {
            totalBalance += (ledgerBalance.creditTotal - ledgerBalance.debitTotal);
        } else if (group.type === 'Expenses' || group.type === 'Assets') {
            totalBalance += (ledgerBalance.debitTotal - ledgerBalance.creditTotal);
        }
    }

    if (group.children && group.children.length > 0) {
        for (const child of group.children) {
            const childBalance = await calculateGroupBalance(child, balanceMap, ledgerGroupMap);
            totalBalance += childBalance.totalBalance;
            totalDebit += childBalance.totalDebit;
            totalCredit += childBalance.totalCredit;
        }
    }
    return { totalBalance, totalDebit, totalCredit };
};


export const getProfitAndLoss = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;

        // Fetch data
        const [allLedgers, incomeGroups, expenseGroups, stockGroups] = await Promise.all([
            Ledger.find({ isActive: true }).lean(),
            Group.find({ type: 'Income', isActive: true }).populate('parentGroup', 'name type slug').lean().sort({ name: 1 }),
            Group.find({ type: 'Expenses', isActive: true }).populate('parentGroup', 'name type slug').lean().sort({ name: 1 }),
            Group.find({
                name: { $in: ['Opening Stock', 'Closing Stock'] },
                isActive: true
            }).populate('parentGroup', 'name type slug').lean()
        ]);

        // Route Stock Groups to respective sides (Opening -> Expenses, Closing -> Income)
        stockGroups.forEach(group => {
            if (group.name === 'Opening Stock') {
                expenseGroups.push(group);
            } else if (group.name === 'Closing Stock') {
                incomeGroups.push(group);
            }
        });

        // Build Comprehensive Map
        const periodBalanceMap = await buildPeriodBalanceMap(startDate, endDate, allLedgers);

        // Map Ledgers to Groups
        const ledgerGroupMap = new Map();
        allLedgers.forEach(ledger => {
            if (ledger.group) {
                const groupId = ledger.group.toString();
                if (!ledgerGroupMap.has(groupId)) {
                    ledgerGroupMap.set(groupId, []);
                }
                ledgerGroupMap.get(groupId).push(ledger);
            }
        });

        // Build Trees
        const incomeTree = buildTree(incomeGroups);
        const expenseTree = buildTree(expenseGroups);

        // Process Groups
        const processGroups = async (groups) => {
            const processedGroups = [];
            for (const group of groups) {
                const balance = await calculateGroupBalance(group, periodBalanceMap, ledgerGroupMap);
                const groupId = group._id || group.id;
                const processedGroup = {
                    _id: groupId,
                    id: groupId,
                    name: group.name,
                    slug: group.slug,
                    type: group.type,
                    parentGroup: group.parentGroup,
                    balance: balance.totalBalance, // Positive value means amount present
                    debitTotal: balance.totalDebit,
                    creditTotal: balance.totalCredit,
                    children: group.children && group.children.length > 0
                        ? await processGroups(group.children)
                        : [],
                    ledgers: []
                };
                processedGroups.push(processedGroup);
            }
            return processedGroups;
        };

        const processedIncome = await processGroups(incomeTree);
        const processedExpenses = await processGroups(expenseTree);

        // Calculate Totals - FIX DOUBLE COUNTING
        const calculateTotal = (groups) => {
            let total = 0;
            groups.forEach(group => {
                total += group.balance;
                // Removed recursive call to children, as group.balance already aggregates children
            });
            return total;
        };

        const totalIncome = calculateTotal(processedIncome);
        const totalExpenses = calculateTotal(processedExpenses);
        const netProfit = totalIncome - totalExpenses;

        successResponse(res, "Profit and Loss data retrieved", 200, {
            income: {
                groups: processedIncome,
                total: totalIncome
            },
            expenses: {
                groups: processedExpenses,
                total: totalExpenses
            },
            totals: {
                totalIncome,
                totalExpenses,
                netProfit
            }
        });

    } catch (error) {
        next(error);
    }
};

export const getStats = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;

        let dateFilter = {};
        if (startDate || endDate) {
            dateFilter.date = {};
            if (startDate) dateFilter.date.$gte = new Date(startDate);
            if (endDate) dateFilter.date.$lte = new Date(endDate);
        }

        let userFilter = {};
        if (req.user.role === 'supervisor') {
            userFilter.supervisor = new mongoose.Types.ObjectId(req.user._id);
        }

        const query = { ...dateFilter, ...userFilter };

        const stats = await Trip.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    totalTrips: { $sum: 1 },
                    completedTrips: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                    },
                    totalSales: { $sum: '$summary.totalSalesAmount' },
                    totalPurchases: { $sum: '$summary.totalPurchaseAmount' },
                    totalProfit: { $sum: '$summary.netProfit' },
                    totalBirdsSold: { $sum: '$summary.totalBirdsSold' },
                    totalWeightSold: { $sum: '$summary.totalWeightSold' }
                }
            }
        ]);

        const dashboardStats = stats[0] || {
            totalTrips: 0,
            completedTrips: 0,
            totalSales: 0,
            totalPurchases: 0,
            totalProfit: 0,
            totalBirdsSold: 0,
            totalWeightSold: 0
        };

        // Recent trips
        const recentTrips = await Trip.find(query)
            .populate('vehicle', 'vehicleNumber')
            .populate('supervisor', 'name')
            .sort({ createdAt: -1 })
            .limit(5);

        successResponse(res, "dashboard stats", 200, {
            stats: dashboardStats,
            recentTrips
        })
    } catch (error) {
        next(error)
    }
}