import Group from "../models/Group.js";
import Ledger from "../models/Ledger.js";
import Customer from "../models/Customer.js";
import Vendor from "../models/Vendor.js";
import InventoryStock from "../models/InventoryStock.js";
import Voucher from "../models/Voucher.js";
import Trip from "../models/Trip.js";
import { successResponse } from "../utils/responseHandler.js";
import AppError from "../utils/AppError.js";
import { toSignedValue } from "../utils/balanceUtils.js";
import mongoose from "mongoose";

// Build hierarchical tree structure
const buildTree = (groups) => {
  const groupMap = new Map();
  const rootGroups = [];

  // Helper to convert ID to string for consistent comparison
  const getIdString = (id) => {
    if (!id) return null;
    if (typeof id === 'string') return id;
    if (id.toString) return id.toString();
    return String(id);
  };

  // First pass: create map of all groups (convert Mongoose documents to plain objects)
  groups.forEach(group => {
    // Convert Mongoose document to plain object if needed
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

  // Second pass: build tree
  groups.forEach(group => {
    const plainGroup = group.toObject ? group.toObject() : group;
    const groupId = getIdString(plainGroup._id || plainGroup.id);
    const node = groupMap.get(groupId);

    if (node) {
      // Handle parentGroup - it might be populated or just an ID
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

// Build voucher balance map (optimized - fetch once, use many times)
const buildVoucherBalanceMap = async (asOnDate = null) => {
  try {
    const query = {
      isActive: true
    };

    if (asOnDate) {
      query.date = { $lte: new Date(asOnDate) };
    }

    // Use aggregation to calculate balances efficiently
    const balanceMap = await Voucher.aggregate([
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

    // Create a map for fast lookup (normalize account names to lowercase)
    const map = new Map();
    balanceMap.forEach(item => {
      if (item._id) {
        const normalizedName = item._id.toString().trim().toLowerCase();
        map.set(normalizedName, {
          debitTotal: item.debitTotal || 0,
          creditTotal: item.creditTotal || 0
        });
      }
    });

    return map;
  } catch (error) {
    console.error('Error building voucher balance map:', error);
    return new Map();
  }
};

// Calculate ledger balance from voucher map (optimized)
const calculateLedgerBalance = (ledgerName, voucherBalanceMap) => {
  try {
    const normalizedName = ledgerName.toString().trim().toLowerCase();
    const balance = voucherBalanceMap.get(normalizedName) || { debitTotal: 0, creditTotal: 0 };

    return {
      debitTotal: balance.debitTotal,
      creditTotal: balance.creditTotal,
      balance: balance.debitTotal - balance.creditTotal
    };
  } catch (error) {
    console.error('Error calculating ledger balance:', error);
    return { debitTotal: 0, creditTotal: 0, balance: 0 };
  }
};
// Calculate customer balance
const calculateCustomerBalance = (customerId, customerName, openingBalance, openingBalanceType, vouchers, trips, date = null) => {
  let periodDebit = 0;
  let periodCredit = 0;
  let openingMovement = 0;
  const end = date ? new Date(date) : null;
  if (end) end.setHours(23, 59, 59, 999);

  if (Array.isArray(vouchers)) {
    vouchers.forEach(voucher => {
      const vDate = new Date(voucher.date);
      if (end && vDate > end) return;
      const isBeforeStart = false; // No start date for balance sheet usually (cumulative)

      let vDebit = 0;
      let vCredit = 0;

      if ((voucher.voucherType === 'Payment' || voucher.voucherType === 'Receipt') && voucher.parties) {
        voucher.parties.forEach(party => {
          if (party.partyId && party.partyId.toString() === customerId.toString() && party.partyType === 'customer') {
            if (voucher.voucherType === 'Payment') vDebit += party.amount || 0;
            else if (voucher.voucherType === 'Receipt') vCredit += party.amount || 0;
          }
        });
      }
      // Skipping legacy name match for performance in bulk report, can be added if critical

      periodDebit += vDebit;
      periodCredit += vCredit;
    });
  }

  if (Array.isArray(trips)) {
    trips.forEach(trip => {
      const tDate = new Date(trip.createdAt);
      if (end && tDate > end) return;

      let tDebit = 0;
      let tCredit = 0;

      if (trip.sales) {
        trip.sales.forEach(sale => {
          if (sale.client && sale.client.toString() === customerId.toString() && !sale.isReceipt) {
            tDebit += sale.amount || 0;
            tCredit += (sale.cashPaid || 0) + (sale.onlinePaid || 0) + (sale.discount || 0);
          }
        });
      }
      periodDebit += tDebit;
      periodCredit += tCredit;
    });
  }

  const openingSigned = toSignedValue(openingBalance || 0, openingBalanceType || 'debit');
  return openingSigned + periodDebit - periodCredit;
};

// Calculate vendor balance
const calculateVendorBalance = (vendorId, vendorName, openingBalance, openingBalanceType, vouchers, trips, stocks, date = null) => {
  let periodDebit = 0;
  let periodCredit = 0;
  const end = date ? new Date(date) : null;
  if (end) end.setHours(23, 59, 59, 999);

  if (Array.isArray(vouchers)) {
    vouchers.forEach(voucher => {
      const vDate = new Date(voucher.date);
      if (end && vDate > end) return;

      let vDebit = 0;
      let vCredit = 0;

      if ((voucher.voucherType === 'Payment' || voucher.voucherType === 'Receipt') && voucher.parties) {
        voucher.parties.forEach(party => {
          if (party.partyId && party.partyId.toString() === vendorId.toString() && party.partyType === 'vendor') {
            if (voucher.voucherType === 'Payment') vDebit += party.amount || 0;
            else if (voucher.voucherType === 'Receipt') vCredit += party.amount || 0;
          }
        });
      }
      periodDebit += vDebit;
      periodCredit += vCredit;
    });
  }

  if (Array.isArray(trips)) {
    trips.forEach(trip => {
      const tDate = new Date(trip.createdAt);
      if (end && tDate > end) return;

      let tDebit = 0;
      let tCredit = 0;

      if (trip.purchases) {
        trip.purchases.forEach(purchase => {
          if (purchase.supplier && purchase.supplier.toString() === vendorId.toString()) {
            tCredit += purchase.amount || 0;
          }
        });
      }
      periodDebit += tDebit;
      periodCredit += tCredit;
    });
  }

  if (Array.isArray(stocks)) {
    stocks.forEach(stock => {
      const sDate = new Date(stock.date);
      if (end && sDate > end) return;
      const stockVendorId = stock.vendorId?._id || stock.vendorId;
      if (stockVendorId && stockVendorId.toString() === vendorId.toString()) {
        if (stock.type === 'purchase' || stock.type === 'opening') {
          periodCredit += stock.amount || 0;
        }
      }
    });
  }

  // Vendors usually have Credit opening balance
  const openingSigned = toSignedValue(openingBalance || 0, openingBalanceType || 'credit');
  return openingSigned + periodDebit - periodCredit;
};
const calculateGroupBalance = async (group, voucherBalanceMap, ledgerGroupMap, vendorGroupMap, customerGroupMap, allVouchers, allTrips, allStocks, asOnDate = null) => {
  let totalBalance = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  let totalOpeningBalance = 0;
  let totalOutstandingBalance = 0;

  // Get all ledgers in this group (from map)
  const groupId = group.id || group._id;
  const ledgers = ledgerGroupMap.get(groupId.toString()) || [];

  // Process all ledgers
  for (const ledger of ledgers) {
    const ledgerBalance = calculateLedgerBalance(ledger.name, voucherBalanceMap);
    totalDebit += ledgerBalance.debitTotal;
    totalCredit += ledgerBalance.creditTotal;
    totalOpeningBalance += ledger.openingBalance || 0;
    totalOutstandingBalance += ledger.outstandingBalance ?? ledger.openingBalance ?? 0;

    // For Assets: Debit - Credit (positive means asset)
    // For Liability: Credit - Debit (positive means liability)
    if (group.type === 'Assets') {
      totalBalance += ledgerBalance.balance;
    } else if (group.type === 'Liability') {
      totalBalance -= ledgerBalance.balance; // Credit - Debit
    }
  }

  // Process vendors
  const vendors = vendorGroupMap.get(groupId.toString()) || [];
  for (const vendor of vendors) {
    const balance = calculateVendorBalance(
      vendor._id,
      vendor.vendorName,
      vendor.openingBalance,
      vendor.openingBalanceType,
      allVouchers,
      allTrips,
      allStocks,
      asOnDate
    );
    // Assuming vendor balance is Debit - Credit (so usually negative for liability)

    // Update totals (approximate debit/credit split is hard without full breakdown return, but balance is key)
    // For simplicity in Balance Sheet, we care about Net Balance effect.
    // But we track totalDebit/TotalCredit for display? balanceSheet.controller uses them.
    // calculateVendorBalance returns NET.
    // Let's assume net negative is Credit, net positive is Debit.
    if (balance >= 0) {
      totalDebit += balance;
    } else {
      totalCredit += Math.abs(balance);
    }

    totalOpeningBalance += vendor.openingBalance || 0;
    // outstandingBalance logic might be complex, skipping for now or assume balance

    if (group.type === 'Assets') {
      totalBalance += balance;
    } else if (group.type === 'Liability') {
      totalBalance -= balance;
    }
  }

  // Process customers
  const customers = customerGroupMap.get(groupId.toString()) || [];
  for (const customer of customers) {
    const balance = calculateCustomerBalance(
      customer._id,
      customer.shopName || customer.ownerName,
      customer.openingBalance,
      customer.openingBalanceType,
      allVouchers,
      allTrips,
      asOnDate
    );

    if (balance >= 0) {
      totalDebit += balance;
    } else {
      totalCredit += Math.abs(balance);
    }

    totalOpeningBalance += customer.openingBalance || 0;

    if (group.type === 'Assets') {
      totalBalance += balance;
    } else if (group.type === 'Liability') {
      totalBalance -= balance;
    }
  }

  // Recursively calculate children balances
  if (group.children && group.children.length > 0) {
    for (const child of group.children) {
      const childBalance = await calculateGroupBalance(child, voucherBalanceMap, ledgerGroupMap, vendorGroupMap, customerGroupMap, allVouchers, allTrips, allStocks, asOnDate);
      totalBalance += childBalance.totalBalance;
      totalDebit += childBalance.totalDebit;
      totalCredit += childBalance.totalCredit;
      totalOpeningBalance += childBalance.totalOpeningBalance;
      totalOutstandingBalance += childBalance.totalOutstandingBalance;
    }
  }

  return { totalBalance, totalDebit, totalCredit, totalOpeningBalance, totalOutstandingBalance };
};

// Calculate Capital/Equity (Income - Expenses) - optimized
const calculateCapital = async (voucherBalanceMap, allLedgers, asOnDate = null) => {
  try {
    // Get all income and expense groups to filters ledgers
    // Better way: Filter allLedgers based on their populated Group type
    // Since we didn't populate group type in the global fetch, we might need a set of group IDs.
    // However, the original code fetched groups to get IDs.

    // Efficient approach: Fetch Income/Expense group IDs
    const incomeGroups = await Group.find({ type: 'Income', isActive: true }).select('_id').lean();
    const expenseGroups = await Group.find({ type: 'Expenses', isActive: true }).select('_id').lean();

    const incomeGroupIds = new Set(incomeGroups.map(g => g._id.toString()));
    const expenseGroupIds = new Set(expenseGroups.map(g => g._id.toString()));

    let totalIncome = 0;
    let totalExpenses = 0;

    // Iterate through all ledgers
    for (const ledger of allLedgers) {
      if (!ledger.group) continue;
      const groupId = ledger.group.toString();

      if (incomeGroupIds.has(groupId)) {
        const balance = calculateLedgerBalance(ledger.name, voucherBalanceMap);
        totalIncome += (balance.creditTotal - balance.debitTotal);
      } else if (expenseGroupIds.has(groupId)) {
        const balance = calculateLedgerBalance(ledger.name, voucherBalanceMap);
        totalExpenses += (balance.debitTotal - balance.creditTotal);
      }
    }

    // Capital = Income - Expenses
    return totalIncome - totalExpenses;
  } catch (error) {
    console.error('Error calculating capital:', error);
    return 0;
  }
};

// Get balance sheet data
export const getBalanceSheet = async (req, res, next) => {
  try {
    const { asOnDate } = req.query;
    const date = asOnDate ? new Date(asOnDate) : new Date();

    // OPTIMIZATION: batch fetch all needed data
    // Query for vouchers/trips/stocks (all active)
    const queryBase = { isActive: true };
    const dateQuery = date ? { date: { $lte: date } } : {};
    const createdQuery = date ? { createdAt: { $lte: date } } : {};

    const [voucherBalanceMap, allLedgers, allVendors, allCustomers, allVouchers, allTrips, allStocks, assetsGroups, liabilityGroups] = await Promise.all([
      buildVoucherBalanceMap(date),
      Ledger.find({ isActive: true }).lean(),
      Vendor.find({ isActive: true }).lean(),
      Customer.find({ isActive: true }).lean(),
      Voucher.find({ ...queryBase, ...dateQuery }).lean(),
      Trip.find(createdQuery).lean(), // Trip uses createdAt
      InventoryStock.find({ ...dateQuery }).lean(), // InventoryStock uses date
      Group.find({ type: 'Assets', isActive: true }).populate('parentGroup', 'name type slug').lean().sort({ name: 1 }),
      Group.find({ type: 'Liability', isActive: true }).populate('parentGroup', 'name type slug').lean().sort({ name: 1 })
    ]);

    // Build Ledger Map (GroupId -> Ledgers)
    const ledgerGroupMap = new Map();
    allLedgers.forEach(ledger => {
      if (ledger.group) {
        const groupId = ledger.group.toString();
        if (!ledgerGroupMap.has(groupId)) ledgerGroupMap.set(groupId, []);
        ledgerGroupMap.get(groupId).push(ledger);
      }
    });

    // Build Vendor Map
    const vendorGroupMap = new Map();
    allVendors.forEach(vendor => {
      if (vendor.group) {
        const groupId = vendor.group.toString();
        if (!vendorGroupMap.has(groupId)) vendorGroupMap.set(groupId, []);
        vendorGroupMap.get(groupId).push(vendor);
      }
    });

    // Build Customer Map
    const customerGroupMap = new Map();
    allCustomers.forEach(customer => {
      if (customer.group) {
        const groupId = customer.group.toString();
        if (!customerGroupMap.has(groupId)) customerGroupMap.set(groupId, []);
        customerGroupMap.get(groupId).push(customer);
      }
    });

    // Build tree structures
    const assetsTree = buildTree(assetsGroups);
    const liabilityTree = buildTree(liabilityGroups);

    // Calculate balances for each group (pass voucher map to avoid re-fetching)
    const processGroups = async (groups) => {
      const processedGroups = [];
      for (const group of groups) {
        const balance = await calculateGroupBalance(
          group,
          voucherBalanceMap,
          ledgerGroupMap,
          vendorGroupMap,
          customerGroupMap,
          allVouchers,
          allTrips,
          allStocks,
          date
        );
        // Ensure we have a clean plain object
        const groupId = group._id || group.id;
        const processedGroup = {
          _id: groupId,
          id: groupId,
          name: group.name,
          slug: group.slug,
          type: group.type,
          parentGroup: group.parentGroup,
          isPredefined: group.isPredefined,
          isActive: group.isActive,
          balance: balance.totalBalance,
          debitTotal: balance.totalDebit,
          creditTotal: balance.totalCredit,
          openingBalance: balance.totalOpeningBalance,
          outstandingBalance: balance.totalOutstandingBalance,
          children: group.children && group.children.length > 0
            ? await processGroups(group.children)
            : [],
          ledgers: []
        };
        processedGroups.push(processedGroup);
      }
      return processedGroups;
    };

    const processedAssets = await processGroups(assetsTree);
    const processedLiabilities = await processGroups(liabilityTree);

    // Calculate capital/equity (pass voucher map)
    const capital = await calculateCapital(voucherBalanceMap, allLedgers, date);

    // Calculate totals
    const calculateTotal = (groups) => {
      let total = 0;
      groups.forEach(group => {
        total += Math.abs(group.balance);
        if (group.children && group.children.length > 0) {
          total += calculateTotal(group.children);
        }
      });
      return total;
    };

    const totalAssets = calculateTotal(processedAssets);
    const totalLiabilities = calculateTotal(processedLiabilities);
    const totalCapital = Math.abs(capital);
    const totalLiabilitiesAndCapital = totalLiabilities + totalCapital;

    successResponse(res, "Balance sheet retrieved successfully", 200, {
      asOnDate: date,
      assets: {
        groups: processedAssets,
        total: totalAssets
      },
      liabilities: {
        groups: processedLiabilities,
        total: totalLiabilities
      },
      capital: {
        amount: capital,
        total: totalCapital
      },
      totals: {
        totalAssets,
        totalLiabilities,
        totalCapital,
        totalLiabilitiesAndCapital,
        balance: totalAssets - totalLiabilitiesAndCapital
      }
    });
  } catch (error) {
    next(error);
  }
};

