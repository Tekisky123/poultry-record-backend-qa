import mongoose from "mongoose";
import validator from "validator";

const paymentSchema = new mongoose.Schema({
  // Customer and Sale references
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  sale: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Trip.sales',
    required: false // Optional for balance payments
  },
  trip: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Trip',
    required: false // Optional for balance payments
  },
  
  // Payment details
  amount: {
    type: Number,
    required: true,
    min: [0, 'Amount cannot be negative']
  },
  paymentMethod: {
    type: String,
    enum: ['upi', 'qr_code', 'bank_transfer', 'cash', 'other'],
    required: true
  },
  
  // Customer details (who is paying)
  customerDetails: {
    name: {
      type: String,
      required: true,
      trim: true
    },
    mobileNumber: {
      type: String,
      required: true,
      validate: {
        validator: val => validator.isMobilePhone(val, "any", { strictMode: true }),
        message: "Invalid mobile number"
      }
    },
    email: {
      type: String,
      validate: {
        validator: val => !val || validator.isEmail(val),
        message: "Invalid email"
      }
    }
  },
  
  // Third party payer details (if someone else is paying)
  thirdPartyPayer: {
    name: {
      type: String,
      trim: true
    },
    mobileNumber: {
      type: String,
      validate: {
        validator: val => !val || validator.isMobilePhone(val, "any", { strictMode: true }),
        message: "Invalid mobile number"
      }
    },
    relationship: {
      type: String,
      enum: ['self', 'family_member', 'friend', 'colleague', 'other'],
      default: 'self'
    }
  },
  
  // Payment verification details
  verificationDetails: {
    transactionId: {
      type: String,
      trim: true
    },
    referenceNumber: {
      type: String,
      trim: true
    },
    bankName: {
      type: String,
      trim: true
    },
    paymentDate: {
      type: Date
    },
    screenshot: {
      type: String, // URL to uploaded screenshot
      trim: true
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters']
    }
  },
  
  // Status and admin verification
  status: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending'
  },
  adminNotes: {
    type: String,
    trim: true,
    maxlength: [500, 'Admin notes cannot exceed 500 characters']
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: {
    type: Date
  },
  
  // Metadata
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform(doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for better query performance
paymentSchema.index({ customer: 1, status: 1 });
paymentSchema.index({ sale: 1 });
paymentSchema.index({ trip: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ submittedBy: 1 });

// Virtual for payment method display name
paymentSchema.virtual('paymentMethodDisplay').get(function() {
  const methods = {
    'upi': 'UPI Payment',
    'qr_code': 'QR Code Payment',
    'bank_transfer': 'Bank Transfer',
    'cash': 'Cash Payment',
    'other': 'Other Method'
  };
  return methods[this.paymentMethod] || 'Unknown';
});

// Virtual for status display name
paymentSchema.virtual('statusDisplay').get(function() {
  const statuses = {
    'pending': 'Pending Verification',
    'verified': 'Verified',
    'rejected': 'Rejected'
  };
  return statuses[this.status] || 'Unknown';
});

const Payment = mongoose.model("Payment", paymentSchema);

export default Payment;
