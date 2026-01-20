import Voucher from "../models/Voucher.js";
import Customer from "../models/Customer.js";
import Vendor from "../models/Vendor.js";
import Ledger from "../models/Ledger.js";
import Sequence from "../models/Sequence.js";
import { successResponse } from "../utils/responseHandler.js";
import AppError from "../utils/AppError.js";
import mongoose from "mongoose";
import { addToBalance, subtractFromBalance } from "../utils/balanceUtils.js";

export const createVoucher = async (req, res, next) => {
    try {
        const { voucherType, date, party, partyName, parties, account, entries, narration } = req.body;

        const isPaymentOrReceipt = voucherType === 'Payment' || voucherType === 'Receipt';

        // Validate required fields based on voucher type
        if (isPaymentOrReceipt) {
            if (!parties || parties.length === 0) {
                throw new AppError('At least one party is required for Payment/Receipt vouchers', 400);
            }
            if (!account) {
                throw new AppError('Account (Cash or Bank) is required for Payment/Receipt vouchers', 400);
            }

            // Validate parties
            for (let partyItem of parties) {
                if (!partyItem.partyId) {
                    throw new AppError('All parties must have a valid customer ID', 400);
                }
                if (!partyItem.amount || partyItem.amount <= 0) {
                    throw new AppError('All parties must have an amount greater than 0', 400);
                }
            }

            // Validate account ledger exists
            const accountLedger = await Ledger.findById(account);
            if (!accountLedger) {
                throw new AppError('Account ledger not found', 404);
            }
        } else {
            // For other voucher types, validate entries
            if (!entries || entries.length === 0) {
                throw new AppError('Voucher entries are required', 400);
            }

            // Validate entries structure
            for (let entry of entries) {
                if (!entry.account) {
                    throw new AppError('Account name is required for each entry', 400);
                }
                if (entry.debitAmount < 0 || entry.creditAmount < 0) {
                    throw new AppError('Debit and credit amounts cannot be negative', 400);
                }
            }
        }

        // If party is provided (for non-Payment/Receipt vouchers), validate it exists
        let partyData = null;
        if (party && !isPaymentOrReceipt) {
            partyData = await Customer.findById(party) || await Vendor.findById(party);
            if (!partyData) {
                throw new AppError('Party not found', 404);
            }
        }

        const nextVoucherNumber = await Sequence.getNextValue('voucherNumber');

        // Generate partyName for Payment/Receipt vouchers from parties array
        let generatedPartyName = null;
        if (isPaymentOrReceipt && parties && parties.length > 0) {
            const partyNames = [];
            for (let partyItem of parties) {
                try {
                    if (partyItem.partyType === 'customer') {
                        const customer = await Customer.findById(partyItem.partyId);
                        if (customer) {
                            partyNames.push(customer.shopName || customer.ownerName || 'Customer');
                        }
                    } else if (partyItem.partyType === 'ledger') {
                        const ledger = await Ledger.findById(partyItem.partyId);
                        if (ledger) {
                            partyNames.push(ledger.name || 'Ledger');
                        }
                    } else if (partyItem.partyType === 'vendor') {
                        const vendor = await Vendor.findById(partyItem.partyId);
                        if (vendor) {
                            partyNames.push(vendor.vendorName || 'Vendor');
                        }
                    }
                } catch (error) {
                    console.error('Error fetching party name:', error);
                }
            }
            generatedPartyName = partyNames.length > 0 ? partyNames.join(', ') : null;
        }

        const voucherData = {
            voucherNumber: nextVoucherNumber,
            voucherType,
            date: date || new Date(),
            party: party || null,
            partyName: partyName || generatedPartyName || (partyData ? partyData.shopName || partyData.vendorName : null),
            parties: isPaymentOrReceipt ? parties : undefined,
            account: isPaymentOrReceipt ? account : undefined,
            entries: entries || [],
            narration,
            createdBy: req.user._id,
            updatedBy: req.user._id
        };

        const voucher = new Voucher(voucherData);
        const savedVoucher = await voucher.save();

        // Update balances for Payment/Receipt vouchers (always update for these voucher types)
        if (isPaymentOrReceipt) {
            // Update party outstanding balances (customers, ledgers, or vendors)
            for (let partyItem of parties) {
                try {
                    const partyType = partyItem.partyType || 'customer'; // Default to customer for backward compatibility

                    if (partyType === 'customer') {
                        const customer = await Customer.findById(partyItem.partyId);
                        if (customer) {
                            // Payment: customer balance increases (debit to customer - we owe them)
                            // Receipt: customer balance decreases (credit to customer - they pay us)
                            const transactionType = voucherType === 'Payment' ? 'debit' : 'credit';
                            const newBalance = addToBalance(
                                customer.outstandingBalance || 0,
                                customer.outstandingBalanceType || 'debit',
                                partyItem.amount,
                                transactionType
                            );

                            customer.outstandingBalance = newBalance.amount;
                            customer.outstandingBalanceType = newBalance.type;
                            customer.updatedBy = req.user._id;
                            await customer.save();
                        }
                    } else if (partyType === 'ledger') {
                        const ledger = await Ledger.findById(partyItem.partyId);
                        if (ledger) {
                            // Payment: ledger balance decreases (credit to ledger)
                            // Receipt: ledger balance increases (debit to ledger)
                            const transactionType = voucherType === 'Payment' ? 'credit' : 'debit';
                            const newBalance = addToBalance(
                                ledger.outstandingBalance || 0,
                                ledger.outstandingBalanceType || 'debit',
                                partyItem.amount,
                                transactionType
                            );

                            ledger.outstandingBalance = newBalance.amount;
                            ledger.outstandingBalanceType = newBalance.type;
                            ledger.updatedBy = req.user._id;
                            await ledger.save();
                        }
                    } else if (partyType === 'vendor') {
                        // Vendors might have ledgers, check if vendor has a ledger
                        const vendorLedger = await Ledger.findOne({ vendor: partyItem.partyId });
                        if (vendorLedger) {
                            // Payment: vendor ledger balance decreases (credit to ledger)
                            // Receipt: vendor ledger balance increases (debit to ledger)
                            const transactionType = voucherType === 'Payment' ? 'credit' : 'debit';
                            const newBalance = addToBalance(
                                vendorLedger.outstandingBalance || 0,
                                vendorLedger.outstandingBalanceType || 'debit',
                                partyItem.amount,
                                transactionType
                            );

                            vendorLedger.outstandingBalance = newBalance.amount;
                            vendorLedger.outstandingBalanceType = newBalance.type;
                            vendorLedger.updatedBy = req.user._id;
                            await vendorLedger.save();
                        }
                    }
                } catch (error) {
                    console.error(`Error updating ${partyItem.partyType || 'party'} balance for party ${partyItem.partyId}:`, error);
                    // Continue with other parties even if one fails
                }
            }

            // Update account ledger balance
            try {
                const accountLedger = await Ledger.findById(account);
                if (accountLedger) {
                    // Payment: account balance decreases (credit to account)
                    // Receipt: account balance increases (debit to account)
                    const totalAmount = parties.reduce((sum, p) => sum + p.amount, 0);
                    const transactionType = voucherType === 'Payment' ? 'credit' : 'debit';
                    const newBalance = addToBalance(
                        accountLedger.outstandingBalance || 0,
                        accountLedger.outstandingBalanceType || 'debit',
                        totalAmount,
                        transactionType
                    );

                    accountLedger.outstandingBalance = newBalance.amount;
                    accountLedger.outstandingBalanceType = newBalance.type;
                    accountLedger.updatedBy = req.user._id;
                    await accountLedger.save();
                }
            } catch (error) {
                console.error('Error updating account ledger balance:', error);
                // Don't fail the voucher creation if balance update fails
            }
        } else {
            // Update balances for Contra/Journal vouchers
            // These vouchers use 'entries' array with 'account' (ledger name), 'debitAmount', 'creditAmount'
            if (entries && entries.length > 0) {
                for (let entry of entries) {
                    try {
                        // Find account doc (Ledger, Customer, or Vendor)
                        // Try Ledger by slug or name
                        let accountDoc = await Ledger.findOne({
                            $or: [
                                { slug: entry.account },
                                { name: entry.account }
                            ]
                        });
                        let accountType = 'ledger';

                        if (!accountDoc) {
                            // Try Customer
                            accountDoc = await Customer.findOne({
                                $or: [
                                    { shopName: entry.account },
                                    { ownerName: entry.account }
                                ]
                            });
                            accountType = 'customer';
                        }

                        if (!accountDoc) {
                            // Try Vendor
                            accountDoc = await Vendor.findOne({ vendorName: entry.account });
                            accountType = 'vendor';
                        }

                        if (accountDoc) {
                            const debitAmount = entry.debitAmount || 0;
                            const creditAmount = entry.creditAmount || 0;

                            if (debitAmount > 0) {
                                // Debit transaction - Money IN / Receivables Increase
                                const newBalance = addToBalance(
                                    accountDoc.outstandingBalance || 0,
                                    accountDoc.outstandingBalanceType || 'debit',
                                    debitAmount,
                                    'debit'
                                );
                                accountDoc.outstandingBalance = newBalance.amount;
                                accountDoc.outstandingBalanceType = newBalance.type;
                                accountDoc.updatedBy = req.user._id;
                                await accountDoc.save();
                            }

                            if (creditAmount > 0) {
                                // Credit transaction - Money OUT / Payables Increase
                                // For Asset accounts/Receivables (Debit balance), Credit means DECREASE
                                // For Liability accounts/Payables (Credit balance), Credit means INCREASE

                                // We use subtractFromBalance with 'debit' transaction type to effectively REDUCE a debit balance
                                // If the account is already 'credit' (liability), subtractFromBalance handles the math correctly 
                                // (Credit - (-Debit) = Credit + Debit) -> Wait, logic check:
                                // subtractFromBalance(amount, type, subtractAmount, subType)
                                // If current is 100 Credit. We want to ADD 10 Credit.
                                // subtract(100, Credit, 10, Debit) -> -100 - (10) = -110 -> 110 Credit. Correct.

                                const newBalance = subtractFromBalance(
                                    accountDoc.outstandingBalance || 0,
                                    accountDoc.outstandingBalanceType || 'debit',
                                    creditAmount,
                                    'debit' // Treating the subtraction as removing 'debit' value
                                );
                                accountDoc.outstandingBalance = newBalance.amount;
                                accountDoc.outstandingBalanceType = newBalance.type;
                                accountDoc.updatedBy = req.user._id;
                                await accountDoc.save();
                            }
                        } else {
                            console.warn(`Account not found for name: ${entry.account}`);
                        }
                    } catch (error) {
                        console.error(`Error updating ledger balance for entry account ${entry.account}:`, error);
                    }
                }
            }
        }

        // Populate party data for response
        const populatedVoucher = await Voucher.findById(savedVoucher._id)
            .populate('party', 'shopName vendorName')
            .populate('parties.partyId', 'shopName ownerName')
            .populate('account', 'name')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');

        successResponse(res, "Voucher created successfully", 201, populatedVoucher);
    } catch (error) {
        next(error);
    }
};

export const getVouchers = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, voucherType, startDate, endDate, search } = req.query;

        // Build query
        const query = { isActive: true };

        if (voucherType) {
            query.voucherType = voucherType;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        if (search) {
            query.$or = [
                { voucherNumber: { $regex: search, $options: 'i' } },
                { partyName: { $regex: search, $options: 'i' } },
                { narration: { $regex: search, $options: 'i' } }
            ];
        }

        const vouchers = await Voucher.find(query)
            .populate('party', 'shopName vendorName')
            .populate('parties.partyId', 'shopName ownerName vendorName name')
            .populate('account', 'name')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name')
            .sort({ date: -1, createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Voucher.countDocuments(query);

        // Calculate totals
        const allVouchers = await Voucher.find(query);
        const totalDebit = allVouchers.reduce((sum, voucher) => sum + voucher.totalDebit, 0);
        const totalCredit = allVouchers.reduce((sum, voucher) => sum + voucher.totalCredit, 0);

        successResponse(res, "Vouchers retrieved successfully", 200, {
            vouchers,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalItems: total,
                itemsPerPage: parseInt(limit)
            },
            totals: {
                totalDebit,
                totalCredit,
                balance: totalDebit - totalCredit
            }
        });
    } catch (error) {
        next(error);
    }
};

export const getVoucherById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const voucher = await Voucher.findOne({ _id: id, isActive: true })
            .populate('party', 'shopName vendorName contact address')
            .populate('parties.partyId', 'shopName ownerName vendorName name')
            .populate('account', 'name')
            .populate('createdBy', 'name email')
            .populate('updatedBy', 'name email');

        if (!voucher) {
            throw new AppError('Voucher not found', 404);
        }

        successResponse(res, "Voucher retrieved successfully", 200, voucher);
    } catch (error) {
        next(error);
    }
};

export const updateVoucher = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { voucherType, date, party, partyName, parties, account, entries, narration } = req.body;

        const voucher = await Voucher.findById(id);
        if (!voucher) {
            throw new AppError('Voucher not found', 404);
        }

        const isPaymentOrReceipt = voucherType === 'Payment' || voucherType === 'Receipt';

        // Validate entries if provided
        if (entries && entries.length > 0) {
            for (let entry of entries) {
                if (!entry.account) {
                    throw new AppError('Account name is required for each entry', 400);
                }
                if (entry.debitAmount < 0 || entry.creditAmount < 0) {
                    throw new AppError('Debit and credit amounts cannot be negative', 400);
                }
            }
        }

        // If party is provided (for non-Payment/Receipt vouchers), validate it exists
        let partyData = null;
        if (party && !isPaymentOrReceipt) {
            partyData = await Customer.findById(party) || await Vendor.findById(party);
            if (!partyData) {
                throw new AppError('Party not found', 404);
            }
        }

        // Generate partyName for Payment/Receipt vouchers from parties array
        let generatedPartyName = null;
        if (isPaymentOrReceipt && parties && parties.length > 0) {
            const partyNames = [];
            for (let partyItem of parties) {
                try {
                    if (partyItem.partyType === 'customer') {
                        const customer = await Customer.findById(partyItem.partyId);
                        if (customer) {
                            partyNames.push(customer.shopName || customer.ownerName || 'Customer');
                        }
                    } else if (partyItem.partyType === 'ledger') {
                        const ledger = await Ledger.findById(partyItem.partyId);
                        if (ledger) {
                            partyNames.push(ledger.name || 'Ledger');
                        }
                    } else if (partyItem.partyType === 'vendor') {
                        const vendor = await Vendor.findById(partyItem.partyId);
                        if (vendor) {
                            partyNames.push(vendor.vendorName || 'Vendor');
                        }
                    }
                } catch (error) {
                    console.error('Error fetching party name:', error);
                }
            }
            generatedPartyName = partyNames.length > 0 ? partyNames.join(', ') : null;
        }

        const updateData = {
            ...(voucherType && { voucherType }),
            ...(date && { date }),
            ...(party !== undefined && { party: party || null }),
            partyName: partyName || generatedPartyName || (partyData ? partyData.shopName || partyData.vendorName : null),
            ...(isPaymentOrReceipt && parties && { parties }),
            ...(isPaymentOrReceipt && account && { account }),
            ...(entries && { entries }),
            ...(narration !== undefined && { narration }),
            updatedBy: req.user._id
        };

        const updatedVoucher = await Voucher.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate('party', 'shopName vendorName')
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');

        successResponse(res, "Voucher updated successfully", 200, updatedVoucher);
    } catch (error) {
        next(error);
    }
};

export const getNextVoucherNumber = async (req, res, next) => {
    try {
        const nextVoucherNumber = await Sequence.peekNextValue('voucherNumber');
        successResponse(res, "Next voucher number", 200, { voucherNumber: nextVoucherNumber });
    } catch (error) {
        next(error);
    }
};

export const deleteVoucher = async (req, res, next) => {
    try {
        const { id } = req.params;

        const voucher = await Voucher.findByIdAndUpdate(
            id,
            { isActive: false, updatedBy: req.user._id },
            { new: true }
        );

        if (!voucher) {
            throw new AppError('Voucher not found', 404);
        }

        successResponse(res, "Voucher deleted successfully", 200, voucher);
    } catch (error) {
        next(error);
    }
};

export const getVoucherStats = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;

        const query = { isActive: true };
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        const vouchers = await Voucher.find(query);

        // Group by voucher type
        const statsByType = {};
        let totalDebit = 0;
        let totalCredit = 0;

        vouchers.forEach(voucher => {
            const type = voucher.voucherType;
            if (!statsByType[type]) {
                statsByType[type] = {
                    count: 0,
                    totalDebit: 0,
                    totalCredit: 0
                };
            }
            statsByType[type].count += 1;
            statsByType[type].totalDebit += voucher.totalDebit;
            statsByType[type].totalCredit += voucher.totalCredit;

            totalDebit += voucher.totalDebit;
            totalCredit += voucher.totalCredit;
        });

        successResponse(res, "Voucher statistics retrieved successfully", 200, {
            statsByType,
            totals: {
                totalVouchers: vouchers.length,
                totalDebit,
                totalCredit,
                balance: totalDebit - totalCredit
            }
        });
    } catch (error) {
        next(error);
    }
};

export const exportVouchers = async (req, res, next) => {
    try {
        const { format = 'excel', voucherType, startDate, endDate } = req.query;

        // Build query
        const query = { isActive: true };
        if (voucherType) query.voucherType = voucherType;
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        const vouchers = await Voucher.find(query)
            .populate('party', 'shopName vendorName')
            .sort({ date: -1 });

        if (format === 'excel') {
            // For Excel export, we'll return JSON data that can be converted to Excel on frontend
            const excelData = vouchers.map(voucher => ({
                'Voucher Number': voucher.voucherNumber,
                'Date': voucher.date.toLocaleDateString(),
                'Voucher Type': voucher.voucherType,
                'Party Name': voucher.partyName || '',
                'Total Debit': voucher.totalDebit,
                'Total Credit': voucher.totalCredit,
                'Narration': voucher.narration || '',
                'Created By': voucher.createdBy?.name || '',
                'Created At': voucher.createdAt.toLocaleDateString()
            }));

            successResponse(res, "Vouchers exported successfully", 200, {
                data: excelData,
                filename: `vouchers_${new Date().toISOString().split('T')[0]}.xlsx`
            });
        } else {
            // For PDF, return structured data
            successResponse(res, "Vouchers data for PDF export", 200, {
                vouchers,
                totals: {
                    totalDebit: vouchers.reduce((sum, v) => sum + v.totalDebit, 0),
                    totalCredit: vouchers.reduce((sum, v) => sum + v.totalCredit, 0)
                }
            });
        }
    } catch (error) {
        next(error);
    }
};
