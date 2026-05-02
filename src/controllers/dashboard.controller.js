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
        const [allLedgers, allGroupsData] = await Promise.all([
            Ledger.find({ isActive: true }).lean(),
            Group.find({ isActive: true }).populate('parentGroup', 'name type slug').lean().sort({ name: 1 })
        ]);

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

        // Build Full Tree of all active groups
        const fullTree = buildTree(allGroupsData);

        // Separate groups into respective sides
        const incomeGroups = fullTree.filter(g => g.type === 'Income');
        const expenseGroups = fullTree.filter(g => g.type === 'Expenses');

        // Opening Stock -> Expenses, Closing Stock -> Income (including their sub-groups)
        const openingStock = fullTree.find(g => g.name === 'Opening Stock');
        if (openingStock && openingStock.type !== 'Expenses') {
            expenseGroups.push(openingStock);
        }

        const closingStock = fullTree.find(g => g.name === 'Closing Stock');
        if (closingStock && closingStock.type !== 'Income') {
            incomeGroups.push(closingStock);
        }

        // Process Groups (calculates balances combining child balances)
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
                    balance: balance.totalBalance,
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

        const processedIncome = await processGroups(incomeGroups);
        const processedExpenses = await processGroups(expenseGroups);

        const injectNatives = async (incomeList, expenseList, startDate, endDate) => {
            let sDate = startDate ? new Date(startDate) : new Date(0);
            let eDate = endDate ? new Date(endDate) : new Date();
            // ensure eDate goes to end of day
            eDate.setHours(23, 59, 59, 999);

            const stocks = await InventoryStock.find({ date: { $lte: eDate } }).lean();
            const trips = await Trip.find({ date: { $lte: eDate } }).lean();
            const isales = await IndirectSale.find({ date: { $gte: sDate, $lte: eDate } }).lean();

            let metricPurchase = 0;
            let metricFeedPurchase = 0;
            let metricSales = 0;
            let metricMortality = 0;
            let metricWeightLoss = 0;
            let metricTripExpenses = 0;

            let c_pWt = 0; let c_pAmt = 0; let c_outWt = 0;
            let prevDate = new Date(sDate.getTime() - 1);
            let o_pWt = 0; let o_pAmt = 0; let o_outWt = 0;

            // Feed stock cumulative trackers
            let c_fpWt = 0; let c_fpAmt = 0; let c_fOutWt = 0;
            let o_fpWt = 0; let o_fpAmt = 0; let o_fOutWt = 0;

            trips.forEach(t => {
                const tDate = new Date(t.date);
                const tDateIsPeriod = tDate >= sDate && tDate <= eDate;

                if (tDateIsPeriod) {
                    metricPurchase += (t.summary?.totalPurchaseAmount || 0);
                    metricSales += (t.summary?.totalSalesAmount || 0);
                    if (t.expenses) t.expenses.forEach(e => metricTripExpenses += (e.amount || 0));
                    if (t.losses) t.losses.forEach(l => {
                        const lDate = new Date(l.date);
                        if (lDate >= sDate && lDate <= eDate) metricMortality += (l.total || 0);
                    });
                    metricWeightLoss += ((t.summary?.birdWeightLoss || 0) * (t.summary?.avgPurchaseRate || 0));
                }
                if (t.stocks && t.stocks.length > 0) {
                    t.stocks.forEach(st => {
                        const stDate = new Date(st.addedAt || tDate);
                        if (stDate <= eDate) { c_pWt += (st.weight || 0); c_pAmt += (st.value || 0); }
                        if (stDate <= prevDate) { o_pWt += (st.weight || 0); o_pAmt += (st.value || 0); }
                    });
                }
            });

            stocks.forEach(s => {
                const sDateVal = new Date(s.date);
                const isPeriod = sDateVal >= sDate && sDateVal <= eDate;

                if (s.inventoryType === 'bird') {
                    if (s.type === 'purchase' || s.type === 'opening') {
                        if (sDateVal <= eDate) { c_pWt += (s.weight || 0); c_pAmt += (s.amount || 0); }
                        if (sDateVal <= prevDate) { o_pWt += (s.weight || 0); o_pAmt += (s.amount || 0); }
                    } else {
                        if (sDateVal <= eDate) c_outWt += (s.weight || 0);
                        if (sDateVal <= prevDate) o_outWt += (s.weight || 0);
                    }
                }

                if (s.inventoryType === 'feed') {
                    if (s.type === 'purchase' || s.type === 'opening') {
                        if (sDateVal <= eDate) { c_fpWt += (s.weight || 0); c_fpAmt += (s.amount || 0); }
                        if (sDateVal <= prevDate) { o_fpWt += (s.weight || 0); o_fpAmt += (s.amount || 0); }
                    } else {
                        if (sDateVal <= eDate) c_fOutWt += (s.weight || 0);
                        if (sDateVal <= prevDate) o_fOutWt += (s.weight || 0);
                    }
                }

                if (isPeriod) {
                    let amt = s.amount || (s.weight * s.rate) || 0;
                    if (s.type === 'purchase') {
                        if (s.inventoryType === 'feed') {
                            metricFeedPurchase += amt;
                        } else {
                            metricPurchase += amt;
                        }
                    }
                    if (s.type === 'sale') metricSales += amt;
                    if (s.type === 'mortality') metricMortality += amt;
                    if (s.type === 'weight_loss' || s.type === 'natural_weight_loss') metricWeightLoss += amt;
                }
            });

            isales.forEach(s => {
                metricPurchase += (s.summary?.totalPurchaseAmount || 0);
                metricSales += (s.summary?.salesAmount || 0);
                metricMortality += (s.mortality?.amount || 0);
            });

            const oRate = o_pWt > 0 ? (o_pAmt / o_pWt) : 0;
            const cRate = c_pWt > 0 ? (c_pAmt / c_pWt) : 0;
            const oFRate = o_fpWt > 0 ? (o_fpAmt / o_fpWt) : 0;
            const cFRate = c_fpWt > 0 ? (c_fpAmt / c_fpWt) : 0;

            const metricOpeningStockLegacy = Math.max(0, c_pWt - c_outWt) * cRate; // legacy for LIVE POULTRY BIRDS inClosing

            // Compute Closing Stock as sum of all monthly CLOSING balances (matches frontend monthly page total)
            // Mirrors LiveBirdsClosingStockMonthlySummary / LiveFeedClosingStockMonthlySummary logic:
            //   closing = apply this month's transactions FIRST, then read balance (opposite of opening)

            // ==============================================================================
            // NEW MONTHLY-SUM LOGIC FOR BIRDS AND FEED (Matches frontend monthly pages)
            // ==============================================================================
            const fyStartYear = sDate.getMonth() >= 3 ? sDate.getFullYear() : sDate.getFullYear() - 1;
            const fyStart = new Date(`${fyStartYear}-04-01T00:00:00.000Z`);
            const fyEnd = new Date(`${fyStartYear + 1}-03-31T23:59:59.999Z`);

            // 1. Gather all stocks (InventoryStock + Trip Stocks)
            const tripStocks = [];
            trips.forEach(t => {
                if (t.stocks && t.stocks.length > 0) {
                    t.stocks.forEach(st => {
                        tripStocks.push({
                            _id: st._id,
                            type: 'purchase',
                            inventoryType: 'bird',
                            date: st.addedAt || t.date,
                            weight: Number(st.weight) || 0,
                            amount: Number(st.value) || 0,
                            rate: Number(st.rate) || 0
                        });
                    });
                }
            });
            const combinedStocks = [...stocks, ...tripStocks].sort((a, b) => new Date(a.date) - new Date(b.date));

            // --- BIRDS LOGIC ---
            const birdStocks = combinedStocks.filter(s => s.inventoryType === 'bird');
            const firstBirdOpStock = birdStocks.find(s => s.type === 'opening');
            let birdAnchorDate = new Date(0);
            if (firstBirdOpStock) {
                const d = new Date(firstBirdOpStock.date);
                const bFyYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
                birdAnchorDate = new Date(`${bFyYear}-04-01T00:00:00.000Z`);
            }

            const b_stocksBeforeFY = [];
            const b_stocksDuringFY = [];
            birdStocks.forEach(s => {
                const date = new Date(s.date);
                if (s.type === 'opening') {
                    if (!firstBirdOpStock || s._id?.toString() !== firstBirdOpStock._id?.toString()) return;
                } else {
                    if (date < birdAnchorDate) return;
                }
                if (date < fyStart) b_stocksBeforeFY.push(s);
                else if (date <= fyEnd) b_stocksDuringFY.push(s);
            });

            const processBirdStock = (s, state) => {
                const w = Number(s.weight) || 0;
                const a = Number(s.amount) || 0;
                if (s.type === 'purchase' || s.type === 'opening') { state.pWt += w; state.pAmt += a; }
                else if (['sale', 'receipt', 'mortality', 'weight_loss', 'natural_weight_loss'].includes(s.type)) { state.outWt += w; }
            };

            // --- FEED LOGIC ---
            const feedStocks = combinedStocks.filter(s => s.inventoryType === 'feed');
            const firstFeedOpStock = feedStocks.find(s => s.type === 'opening');
            let feedAnchorDate = new Date(0);
            if (firstFeedOpStock) {
                const d = new Date(firstFeedOpStock.date);
                const fFyYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
                feedAnchorDate = new Date(`${fFyYear}-04-01T00:00:00.000Z`);
            }

            const f_stocksBeforeFY = [];
            const f_stocksDuringFY = [];
            feedStocks.forEach(s => {
                const date = new Date(s.date);
                if (s.type === 'opening') {
                    if (!firstFeedOpStock || s._id?.toString() !== firstFeedOpStock._id?.toString()) return;
                } else {
                    if (date < feedAnchorDate) return;
                }
                if (date < fyStart) f_stocksBeforeFY.push(s);
                else if (date <= fyEnd) f_stocksDuringFY.push(s);
            });

            const processFeedStock = (s, state) => {
                const w = Number(s.weight) || 0;
                const a = Number(s.amount) || 0;
                if (s.type === 'purchase' || s.type === 'opening') { state.pWt += w; state.pAmt += a; }
                else if (['consume', 'sale', 'receipt', 'mortality', 'weight_loss', 'natural_weight_loss'].includes(s.type)) { state.outWt += w; }
            };

            // Calculate Metrics
            let metricBirdsOpeningStock = 0; let metricBirdsClosingStock = 0;
            let metricFeedOpeningStock = 0; let metricFeedClosingStock = 0;

            const b_opState = { pWt: 0, pAmt: 0, outWt: 0 };
            const b_clState = { pWt: 0, pAmt: 0, outWt: 0 };
            b_stocksBeforeFY.forEach(s => { processBirdStock(s, b_opState); processBirdStock(s, b_clState); });

            const f_opState = { pWt: 0, pAmt: 0, outWt: 0 };
            const f_clState = { pWt: 0, pAmt: 0, outWt: 0 };
            f_stocksBeforeFY.forEach(s => { processFeedStock(s, f_opState); processFeedStock(s, f_clState); });

            for (let i = 0; i < 12; i++) {
                const mStart = new Date(fyStartYear, 3 + i, 1);
                const mEnd = new Date(fyStartYear, 3 + i + 1, 0, 23, 59, 59, 999);

                // --- OPENING BALANCES (Read BEFORE month's transactions) ---
                const bOpRate = b_opState.pWt > 0 ? b_opState.pAmt / b_opState.pWt : 0;
                metricBirdsOpeningStock += Math.max(0, b_opState.pWt - b_opState.outWt) * bOpRate;

                const fOpRate = f_opState.pWt > 0 ? f_opState.pAmt / f_opState.pWt : 0;
                metricFeedOpeningStock += Math.max(0, f_opState.pWt - f_opState.outWt) * fOpRate;

                // --- PROCESS MONTH'S TRANSACTIONS ---
                b_stocksDuringFY.forEach(s => {
                    const d = new Date(s.date);
                    if (d >= mStart && d <= mEnd) { processBirdStock(s, b_opState); processBirdStock(s, b_clState); }
                });
                f_stocksDuringFY.forEach(s => {
                    const d = new Date(s.date);
                    if (d >= mStart && d <= mEnd) { processFeedStock(s, f_opState); processFeedStock(s, f_clState); }
                });

                // --- CLOSING BALANCES (Read AFTER month's transactions) ---
                const bClRate = b_clState.pWt > 0 ? b_clState.pAmt / b_clState.pWt : 0;
                metricBirdsClosingStock += Math.max(0, b_clState.pWt - b_clState.outWt) * bClRate;

                const fClRate = f_clState.pWt > 0 ? f_clState.pAmt / f_clState.pWt : 0;
                metricFeedClosingStock += Math.max(0, f_clState.pWt - f_clState.outWt) * fClRate;
            }

            const metricOpeningStock = Math.max(0, o_pWt - o_outWt) * oRate;
            const metricClosingStock = metricOpeningStockLegacy;

            const updateTrees = (grpList, isOpeningParent = false, isClosingParent = false) => {
                let diffAccumulator = 0;
                grpList.forEach(g => {
                    const name = g.name.trim().toUpperCase();
                    const inOpening = isOpeningParent || name === 'OPENING STOCK';
                    const inClosing = isClosingParent || name === 'CLOSING STOCK';

                    let childDiff = 0;
                    if (g.children && g.children.length > 0) {
                        childDiff = updateTrees(g.children, inOpening, inClosing);
                    }

                    let oldBalance = g.balance || 0;
                    let targetValue = null;

                    if (name.includes('POULTRY FEED PURCHASE')) targetValue = metricFeedPurchase;
                    else if (name.includes('LIVE POULTRY BIRDS PURCHASE') || name.includes('LIVE POULTRY BIRDS PURCHASES')) targetValue = metricPurchase;
                    else if (name.includes('LIVE POULTRY BIRDS SALES') || (name.includes('LIVE POULTRY BIRDS') && name.includes('SALES'))) targetValue = metricSales;
                    else if (name.includes('BIRDS MORTALITY')) targetValue = metricMortality;
                    else if (name.includes('BIRDS WEIGHT LOSS')) targetValue = metricWeightLoss;
                    else if (name.includes('TRIP EXPENSES')) targetValue = metricTripExpenses;
                    else if (name === 'BIRDS STOCK' && inClosing) targetValue = metricBirdsClosingStock;
                    else if (name === 'FEED STOCK' && inClosing) targetValue = metricFeedClosingStock;
                    else if (name === 'BIRDS OPENING STOCK') targetValue = metricBirdsOpeningStock;
                    else if (name === 'FEED OPENING STOCK') targetValue = metricFeedOpeningStock;
                    else if (name.includes('LIVE POULTRY BIRDS') && inOpening) targetValue = metricOpeningStock;
                    else if (name.includes('LIVE POULTRY BIRDS') && inClosing) targetValue = metricClosingStock;

                    if (targetValue !== null) {
                        const localDiff = targetValue - oldBalance;
                        g.balance = targetValue;
                        diffAccumulator += localDiff + childDiff;
                    } else if (childDiff !== 0) {
                        g.balance += childDiff;
                        diffAccumulator += childDiff;
                    }
                });
                return diffAccumulator;
            };

            updateTrees(incomeList);
            updateTrees(expenseList);
        };

        await injectNatives(processedIncome, processedExpenses, startDate, endDate);

        // Calculate Totals - using the processed root groups
        const calculateTotal = (groups) => {
            let total = 0;
            groups.forEach(group => {
                total += (group.balance || 0);
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