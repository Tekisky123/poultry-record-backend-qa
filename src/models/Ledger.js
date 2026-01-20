import mongoose from "mongoose";

const ledgerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Ledger name is required"],
        trim: true,
        minlength: [2, "Ledger name must be at least 2 characters"],
        maxlength: [100, "Ledger name cannot exceed 100 characters"]
    },
    slug: {
        type: String,
        trim: true,
        unique: true,
        lowercase: true,
        index: true
    },
    group: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: [true, "Group is required"]
    },
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor',
        default: null
    },
    customer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        default: null
    },
    ledgerType: {
        type: String,
        enum: {
            values: ['vendor', 'customer', 'other'],
            message: 'Ledger type must be one of: vendor, customer, other'
        },
        default: 'other'
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
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    openingBalance: {
        type: Number,
        default: 0
    },
    openingBalanceType: {
        type: String,
        enum: ['debit', 'credit'],
        default: 'debit'
    },
    outstandingBalance: {
        type: Number,
        default: function () {
            return this.openingBalance || 0;
        }
    },
    outstandingBalanceType: {
        type: String,
        enum: ['debit', 'credit'],
        default: function () {
            return this.openingBalanceType || 'debit';
        }
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

// Index for efficient queries
ledgerSchema.index({ group: 1 });
ledgerSchema.index({ vendor: 1 });
ledgerSchema.index({ customer: 1 });
ledgerSchema.index({ ledgerType: 1 });
ledgerSchema.index({ isActive: 1 });


// Pre-save hook to generate slug
ledgerSchema.pre('save', function (next) {
    if (!this.slug && this.name) {
        this.slug = this.name
            .toString()
            .toLowerCase()
            .trim()
            .replace(/[\s\W-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
    next();
});


const Ledger = mongoose.model("Ledger", ledgerSchema);

export default Ledger;

