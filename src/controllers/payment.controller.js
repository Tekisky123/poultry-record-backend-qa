import Payment from '../models/Payment.js';
import Trip from '../models/Trip.js';
import Customer from '../models/Customer.js';
import AppError from '../utils/AppError.js';
import { successResponse } from '../utils/responseHandler.js';
import mongoose from 'mongoose';

// Customer panel - Submit payment
export const submitPayment = async (req, res, next) => {
    try {
        const { saleId, amount, paymentMethod, customerDetails, thirdPartyPayer, verificationDetails } = req.body;
        const userId = req.user._id;

        // Find customer by user ID
        const customer = await Customer.findOne({ user: userId, isActive: true });
        if (!customer) {
            throw new AppError('Customer profile not found', 404);
        }

        // Validate payment amount
        if (amount <= 0) {
            throw new AppError('Payment amount must be greater than zero', 400);
        }

        // Validate against opening balance
        if (amount > customer.outstandingBalance) {
            throw new AppError('Payment amount cannot exceed opening balance', 400);
        }

        // Create payment record
        const payment = new Payment({
            customer: customer._id,
            sale: null, // Opening balance payments don't have specific sales
            trip: null, // Opening balance payments don't have specific trips
            amount,
            paymentMethod,
            customerDetails: {
                name: customerDetails.name,
                mobileNumber: customerDetails.mobileNumber,
                email: customerDetails.email
            },
            thirdPartyPayer: thirdPartyPayer || null,
            verificationDetails: verificationDetails || {},
            submittedBy: userId
        });

        await payment.save();

        // Populate the payment with customer details
        await payment.populate([
            { path: 'customer', select: 'shopName ownerName contact' },
            { path: 'submittedBy', select: 'name email' }
        ]);

        successResponse(res, "Payment submitted successfully", 201, payment);
    } catch (error) {
        next(error);
    }
};

// Customer panel - Get customer's payment history
export const getCustomerPayments = async (req, res, next) => {
    try {
        const { id } = req.params; // User ID
        const { status, page = 1, limit = 10 } = req.query;

        // Find customer by user ID
        const customer = await Customer.findOne({ user: id });
        if (!customer) {
            throw new AppError('Customer profile not found', 404);
        }

        // Build query
        const query = { customer: customer._id };
        if (status) {
            query.status = status;
        }

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

// Admin panel - Get all pending payments
export const getPendingPayments = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, status = 'pending' } = req.query;

        const query = { status, isActive: true };
        
        const payments = await Payment.find(query)
            .populate('customer', 'shopName ownerName contact')
            .populate('trip', 'tripId date supervisor')
            .populate('submittedBy', 'name email')
            .populate('verifiedBy', 'name')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Payment.countDocuments(query);

        successResponse(res, "Pending payments retrieved successfully", 200, {
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

// Admin panel - Verify payment
export const verifyPayment = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, adminNotes } = req.body;
        const adminId = req.user._id;

        if (!['verified', 'rejected'].includes(status)) {
            throw new AppError('Invalid status. Must be verified or rejected', 400);
        }

        const payment = await Payment.findById(id);
        if (!payment) {
            throw new AppError('Payment record not found', 404);
        }

        // Update payment status
        payment.status = status;
        payment.adminNotes = adminNotes;
        payment.verifiedBy = adminId;
        payment.verifiedAt = new Date();

        await payment.save();

        // If verified, update the customer's opening balance
        if (status === 'verified') {
            // Find the customer to get current outstanding balance
            const customer = await Customer.findById(payment.customer);
            if (customer) {
                // Calculate new outstanding balance
                const newOutstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - payment.amount);
                
                // Update customer's outstanding balance without triggering full validation
                // This prevents errors if customer has missing required fields like 'place'
                await Customer.findByIdAndUpdate(
                    payment.customer,
                    { 
                        $set: { 
                            outstandingBalance: newOutstandingBalance,
                            updatedBy: adminId
                        } 
                    },
                    { runValidators: false } // Skip validation to avoid "Place is required" error
                );
            }

            // If this is a sale payment (has trip and sale), also update the sale balance
            if (payment.trip && payment.sale) {
                const trip = await Trip.findById(payment.trip);
                if (trip) {
                    const sale = trip.sales.find(s => s._id.toString() === payment.sale.toString());
                    if (sale) {
                        // Update sale payment details
                        sale.cashPaid = (sale.cashPaid || 0) + payment.amount;
                        sale.receivedAmount = (sale.cashPaid || 0) + (sale.onlinePaid || 0);
                        sale.balance = sale.amount - sale.receivedAmount - (sale.discount || 0);
                        
                        await trip.save();
                    }
                }
            }
        }

        // Populate the updated payment
        const populateFields = [
            { path: 'customer', select: 'shopName ownerName contact' },
            { path: 'verifiedBy', select: 'name email' }
        ];
        
        if (payment.trip) {
            populateFields.push({ path: 'trip', select: 'tripId date' });
        }

        await payment.populate(populateFields);

        successResponse(res, `Payment ${status} successfully`, 200, payment);
    } catch (error) {
        next(error);
    }
};

// Admin panel - Get payment statistics
export const getPaymentStats = async (req, res, next) => {
    try {
        const stats = await Payment.aggregate([
            { $match: { isActive: true } },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                }
            }
        ]);

        const totalPending = stats.find(s => s._id === 'pending') || { count: 0, totalAmount: 0 };
        const totalVerified = stats.find(s => s._id === 'verified') || { count: 0, totalAmount: 0 };
        const totalRejected = stats.find(s => s._id === 'rejected') || { count: 0, totalAmount: 0 };

        successResponse(res, "Payment statistics retrieved successfully", 200, {
            pending: {
                count: totalPending.count,
                amount: totalPending.totalAmount
            },
            verified: {
                count: totalVerified.count,
                amount: totalVerified.totalAmount
            },
            rejected: {
                count: totalRejected.count,
                amount: totalRejected.totalAmount
            },
            total: {
                count: totalPending.count + totalVerified.count + totalRejected.count,
                amount: totalPending.totalAmount + totalVerified.totalAmount + totalRejected.totalAmount
            }
        });
    } catch (error) {
        next(error);
    }
};

// Get payment details by ID
export const getPaymentById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const payment = await Payment.findById(id)
            .populate('customer', 'shopName ownerName contact')
            .populate('trip', 'tripId date supervisor')
            .populate('submittedBy', 'name email')
            .populate('verifiedBy', 'name email');

        if (!payment) {
            throw new AppError('Payment record not found', 404);
        }

        successResponse(res, "Payment details retrieved successfully", 200, payment);
    } catch (error) {
        next(error);
    }
};
