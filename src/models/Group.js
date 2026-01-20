import mongoose from "mongoose";

const groupSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Group name is required"],
        trim: true,
        unique: true,
        minlength: [2, "Group name must be at least 2 characters"],
        maxlength: [100, "Group name cannot exceed 100 characters"]
    },
    slug: {
        type: String,
        trim: true,
        unique: true,
        lowercase: true,
        index: true
    },
    type: {
        type: String,
        required: [true, "Group type is required"],
        enum: {
            values: ['Liability', 'Assets', 'Expenses', 'Income', 'Others'],
            message: 'Group type must be one of: Liability, Assets, Expenses, Income, Others'
        }
    },
    parentGroup: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        default: null
    },
    isPredefined: {
        type: Boolean,
        default: false
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
groupSchema.index({ parentGroup: 1 });
groupSchema.index({ type: 1 });
groupSchema.index({ isActive: 1 });


// Pre-save hook to generate slug
groupSchema.pre('save', function (next) {
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

// Virtual for child groups count
groupSchema.virtual('childrenCount', {
    ref: 'Group',
    localField: '_id',
    foreignField: 'parentGroup',
    count: true
});

// Virtual for ledgers count
groupSchema.virtual('ledgersCount', {
    ref: 'Ledger',
    localField: '_id',
    foreignField: 'group',
    count: true
});

const Group = mongoose.model("Group", groupSchema);

export default Group;

