import mongoose from 'mongoose';

const purchaseSchema = new mongoose.Schema({
    dcNumber: {
        type: String,
        trim: true,
        default: ''
    },
    birds: {
        type: Number,
        required: true,
        min: [0, 'Bird count cannot be negative'],
        default: 0
    },
    weight: {
        type: Number,
        required: true,
        min: [0, 'Weight cannot be negative'],
        default: 0
    },
    avg: {
        type: Number,
        default: 0
    },
    rate: {
        type: Number,
        required: true,
        min: [0, 'Rate cannot be negative'],
        default: 0
    },
    amount: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

const mortalitySchema = new mongoose.Schema({
    birds: { type: Number, default: 0 },
    weight: { type: Number, default: 0 },
    avgWeight: { type: Number, default: 0 },
    rate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 }
}, { _id: false });

const salesSchema = new mongoose.Schema({
    birds: { type: Number, default: 0 },
    weight: { type: Number, default: 0 },
    avgWeight: { type: Number, default: 0 },
    rate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 }
}, { _id: false });

const summarySchema = new mongoose.Schema({
    totalPurchaseBirds: { type: Number, default: 0 },
    totalPurchaseWeight: { type: Number, default: 0 },
    totalPurchaseAverage: { type: Number, default: 0 },
    totalPurchaseRate: { type: Number, default: 0 },
    totalPurchaseAmount: { type: Number, default: 0 },
    salesAmount: { type: Number, default: 0 },
    purchaseAmount: { type: Number, default: 0 },
    grossProfit: { type: Number, default: 0 },
    mortalityAmount: { type: Number, default: 0 },
    netProfit: { type: Number, default: 0 },
    margin: { type: Number, default: 0 }
}, { _id: false });

const indirectSaleSchema = new mongoose.Schema({
    invoiceNumber: {
        type: String,
        trim: true,
        unique: true,
        sparse: true
    },
    date: {
        type: Date,
        required: true
    },
    customer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true
    },
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor',
        required: true
    },
    place: {
        type: String,
        trim: true,
        default: ''
    },
    vehicleNumber: {
        type: String,
        trim: true,
        default: ''
    },
    driver: {
        type: String,
        trim: true,
        default: ''
    },
    purchases: [purchaseSchema],
    mortality: {
        type: mortalitySchema,
        default: () => ({})
    },
    sales: {
        type: salesSchema,
        default: () => ({})
    },
    summary: {
        type: summarySchema,
        default: () => ({})
    },
    notes: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['draft', 'completed'],
        default: 'draft'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
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

function roundNumber(value, decimals = 2) {
    if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
    return Number(Number(value).toFixed(decimals));
}

indirectSaleSchema.methods.recalculateSummary = function () {
    const totalPurchaseBirds = this.purchases.reduce((sum, item) => sum + (item.birds || 0), 0);
    const totalPurchaseWeight = this.purchases.reduce((sum, item) => sum + (item.weight || 0), 0);
    const totalPurchaseAmount = this.purchases.reduce((sum, item) => sum + (item.amount || 0), 0);

    const totalPurchaseAverage = totalPurchaseBirds > 0 ? totalPurchaseWeight / totalPurchaseBirds : 0;
    const totalPurchaseRate = totalPurchaseWeight > 0 ? totalPurchaseAmount / totalPurchaseWeight : 0;

    const mortalityBirds = this.mortality?.birds || 0;
    const mortalityWeight = mortalityBirds > 0 ? totalPurchaseAverage * mortalityBirds : 0;
    const mortalityAvgWeight = mortalityBirds > 0 ? totalPurchaseAverage : 0;
    const mortalityRate = mortalityBirds > 0 ? totalPurchaseRate : 0;
    const mortalityAmount = mortalityWeight * mortalityRate;

    const saleBirds = Math.max(totalPurchaseBirds - mortalityBirds, 0);
    const saleWeight = Math.max(totalPurchaseWeight - mortalityWeight, 0);
    const saleAvg = saleBirds > 0 ? saleWeight / saleBirds : 0;
    const saleRate = this.sales?.rate || 0;
    const saleAmount = saleWeight * saleRate;

    this.mortality = {
        birds: roundNumber(mortalityBirds, 0),
        weight: roundNumber(mortalityWeight),
        avgWeight: roundNumber(mortalityAvgWeight),
        rate: roundNumber(mortalityRate),
        amount: roundNumber(mortalityAmount)
    };

    this.sales = {
        birds: roundNumber(saleBirds, 0),
        weight: roundNumber(saleWeight),
        avgWeight: roundNumber(saleAvg),
        rate: roundNumber(saleRate),
        amount: roundNumber(saleAmount)
    };

    const grossProfit = saleAmount - totalPurchaseAmount;
    const netProfit = grossProfit - mortalityAmount;
    const margin = saleWeight > 0 ? netProfit / saleWeight : 0;

    this.summary = {
        totalPurchaseBirds: roundNumber(totalPurchaseBirds, 0),
        totalPurchaseWeight: roundNumber(totalPurchaseWeight),
        totalPurchaseAverage: roundNumber(totalPurchaseAverage),
        totalPurchaseRate: roundNumber(totalPurchaseRate),
        totalPurchaseAmount: roundNumber(totalPurchaseAmount),
        salesAmount: roundNumber(saleAmount),
        purchaseAmount: roundNumber(totalPurchaseAmount),
        grossProfit: roundNumber(grossProfit),
        mortalityAmount: roundNumber(mortalityAmount),
        netProfit: roundNumber(netProfit),
        margin: roundNumber(margin, 4)
    };
};

const IndirectSale = mongoose.model('IndirectSale', indirectSaleSchema);

export default IndirectSale;

