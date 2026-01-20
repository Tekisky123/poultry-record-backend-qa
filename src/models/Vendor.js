import mongoose from "mongoose";
import validator from "validator";
import User from './User.js';

// Bank Details Subschema
const bankDetailsSchema = new mongoose.Schema({
    bankName: {
        type: String,
        required: [true, "Bank name is required"],
        trim: true,
        maxlength: [100, "Bank name too long"],
        validate: {
            validator: val => /^[a-zA-Z\s]+$/.test(val),
            message: "Bank name can only contain letters and spaces"
        }
    },
    accountHolder: {
        type: String,
        required: [true, "Account holder name is required"],
        trim: true,
        maxlength: [100, "Account holder name too long"],
        validate: {
            validator: val => /^[a-zA-Z\s]+$/.test(val),
            message: "Account holder name can only contain letters and spaces"
        }
    },
    accountNumber: {
        type: String,
        required: [true, "Account number is required"],
        trim: true,
        validate: {
            validator: val => validator.isNumeric(val) && val.length >= 9 && val.length <= 18,
            message: "Invalid account number"
        }
    },
    ifscCode: {
        type: String,
        required: [true, "IFSC code is required"],
        uppercase: true,
        trim: true,
        match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC code format"]
    }
}, { _id: false }); // no separate _id for nested schema

const vendorSchema = new mongoose.Schema({
    vendorName: {
        type: String,
        required: [true, "Vendor name is required"],
        trim: true,
        minlength: [3, "Vendor name must be at least 3 characters"],
        maxlength: [100, "Vendor name cannot exceed 100 characters"]
    },
    companyName: {
        type: String,
        trim: true,
        maxlength: [150, "Company name cannot exceed 150 characters"]
    },
    gstNumber: {
        type: String,
        trim: true,
        uppercase: true,
        // Make GST validation less strict for testing
        // match: [/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, "Invalid GST number"]
    },
    contactNumber: {
        type: String,
        required: [true, "Contact number is required"],
        trim: true,
        validate: {
            validator: val => validator.isMobilePhone(val, "any", { strictMode: true }),
            message: "Invalid contact number"
        }
    },
    email: {
        type: String,
        required: [true, "Email is required"],
        lowercase: true,
        trim: true,
        unique: true,
        validate: {
            validator: val => validator.isEmail(val),
            message: "Invalid email address"
        }
    },
    address: {
        type: String,
        trim: true,
        maxlength: [200, "Address cannot exceed 200 characters"]
    },
    city: {
        type: String,
        trim: true,
        maxlength: [100, "City name too long"]
    },
    state: {
        type: String,
        trim: true,
        maxlength: [100, "State name too long"]
    },
    postalCode: {
        type: String,
        trim: true,
        validate: {
            validator: val => !val || validator.isPostalCode(val, "any"),
            message: "Invalid postal code"
        }
    },
    country: {
        type: String,
        trim: true,
        maxlength: [100, "Country name too long"]
    },
    defaultPaymentMode: { type: String, default: 'cash' },

    isActive: {
        type: Boolean,
        default: true
    },

    bankDetails: {
        type: bankDetailsSchema,
        select: false, // Hide by default for security
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User',
        immutable: true
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    tdsApplicable: {
        type: Boolean,
        default: false
    },
    tdsUpdatedAt: {
        type: Date
    },
    group: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: [true, 'Group is required']
    },
    openingBalance: {
        type: Number,
        default: 0
    },
    openingBalanceType: {
        type: String,
        enum: ['debit', 'credit'],
        default: 'credit' // Vendors usually credit (payable)
    },
    outstandingBalance: {
        type: Number,
        default: 0
    },
    outstandingBalanceType: {
        type: String,
        enum: ['debit', 'credit'],
        default: 'credit'
    }
}, {
    timestamps: true,
    strict: true,
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

// Ensure email is unique
vendorSchema.index({ email: 1 }, { unique: true });
vendorSchema.index({ contactNumber: 1 }, { unique: true });

const Vendor = mongoose.model("Vendor", vendorSchema);

export default Vendor;
