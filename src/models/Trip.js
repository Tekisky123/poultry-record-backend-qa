import mongoose from "mongoose";
import Sequence from "./Sequence.js";

const tripSchema = new mongoose.Schema({
    tripId: { 
        type: String, 
        required: false, 
        unique: true
    },
    // sequence: { 
    //     type: Number, 
    //     required: true,
    //     unique: true
    // },
    date: { type: Date, required: true },
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    supervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    driver: { type: String, required: true },
    labour: { type: String, default: '' }, // Optional labour worker name
    route: {
        from: { type: String, required: true }, // Start location
        to: { type: String, required: true }, // End location
        distance: Number
    },

    // Vehicle Readings
    vehicleReadings: {
        opening: { type: Number, required: true }, // Opening odometer reading
        closing: { type: Number }, // Closing odometer reading
        totalDistance: { type: Number } // Calculated distance
    },

    // Diesel and Rent
    diesel: {
        stations: [{
            name: String,
            stationName: String,
            volume: Number,
            rate: Number,
            amount: Number,
            receipt: String,
            timestamp: { type: Date, default: Date.now }
        }],
        totalVolume: { type: Number, default: 0 },
        totalAmount: { type: Number, default: 0 }
    },

    // Rent and Distance
    rentPerKm: { type: Number, default: 0 }, // Rent per kilometer from vehicle
    totalKm: { type: Number, default: 0 }, // Total kilometers traveled
    dieselAmount: { type: Number, default: 0 }, // Total diesel amount spent

    // Trip Expenses
    expenses: [{
        category: { 
            type: String, 
            enum: ['parking','meals', 'toll', 'maintenance', 'tea', 'lunch', 'loading/unloading', 'other'],
            required: true
        },
        amount: { type: Number, required: true },
        receipt: String,
        description: String,
        timestamp: { type: Date, default: Date.now }
    }],

    // Bird Purchases
    purchases: [{
        supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
        vendorName: { type: String, default: '' }, // Vendor name stored for transferred trips
        dcNumber: { type: String, required: true },
        birds: { type: Number, required: true },
        weight: { type: Number, required: true },
        avgWeight: { type: Number }, // Calculated field
        rate: { type: Number, required: true },
        amount: { type: Number, required: true },
        // paymentMode: { type: String, enum: ['cash', 'credit', 'advance'], default: 'cash' },
        // paymentStatus: { type: String, enum: ['paid', 'pending', 'partial'], default: 'pending' },
        timestamp: { type: Date, default: Date.now }
    }],

    // Bird Sales
    sales: [{
        client: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
        billNumber: { type: String, required: true },
        birds: { type: Number, required: true },
        weight: { type: Number, required: true },
        avgWeight: { type: Number }, // Calculated field
        rate: { type: Number, required: true },
        amount: { type: Number, required: true },
        product: { type: String, default: '' }, // Vendor name from first purchase
        profitMargin: { type: Number, default: 0 }, // Calculated: (saleRate - avgPurchaseRate)
        profitAmount: { type: Number, default: 0 }, // Calculated: profitMargin * weight
        // paymentMode: { type: String, enum: ['cash', 'online', 'credit'], default: 'cash' },
        // paymentStatus: { type: String, enum: ['paid', 'pending', 'partial'], default: 'pending' },
        receivedAmount: { type: Number, default: 0 },
        discount: { type: Number, default: 0 },
        cashPaid: { type: Number, default: 0 },
        onlinePaid: { type: Number, default: 0 },
        cashLedger: { type: mongoose.Schema.Types.ObjectId, ref: 'Ledger' }, // Cash-in-Hand ledger for cash payments
        onlineLedger: { type: mongoose.Schema.Types.ObjectId, ref: 'Ledger' }, // Bank Account ledger for online payments
        balance: { type: Number, default: 0 }, // Calculated balance after this sale
        outstandingBalance: { type: Number, default: 0 }, // Customer's balance AFTER this transaction
        saleOutBalance: { type: Number, default: 0 }, // Customer's outstanding balance at the time of sale creation (signed value)
        saleOutBalanceType: { type: String, enum: ['debit', 'credit'], default: 'debit' }, // Type of saleOutBalance
        // Balance for each particular (for accurate customer purchase ledger)
        balanceForSale: { type: Number, default: 0 }, // Balance after adding sale amount
        balanceForCashPaid: { type: Number, default: 0 }, // Balance after subtracting cashPaid
        balanceForOnlinePaid: { type: Number, default: 0 }, // Balance after subtracting onlinePaid
        balanceForDiscount: { type: Number, default: 0 }, // Balance after subtracting discount
        timestamp: { type: Date, default: Date.now }
    }],

    // Losses - Death Birds
    losses: [{
        quantity: { type: Number, required: true },
        weight: { type: Number, required: true },
        avgWeight: { type: Number }, // Calculated field
        rate: { type: Number, required: true },
        total: { type: Number, required: true }, // Calculated field
        reason: { type: String }, // Reason for death
        date: { type: Date, required: true },
        timestamp: { type: Date, default: Date.now }
    }],

    // Stock Management - Multiple Stock Entries
    stocks: [{
        birds: { type: Number, required: true },
        weight: { type: Number, required: true },
        avgWeight: { type: Number, default: 0 },
        value: { type: Number, default: 0 }, // Not counted in profit
        rate: { type: Number, required: true }, // Purchase rate for this stock
        addedAt: { type: Date, default: Date.now },
        notes: { type: String, default: '' }
    }],

    // Trip Summary
    summary: {
        totalPurchaseAmount: { type: Number, default: 0 },
        totalSalesAmount: { type: Number, default: 0 }, // Customer + Stock + Transfers (for financial calculations)
        customerSalesAmount: { type: Number, default: 0 }, // Only customer sales (for display in SALES DETAILS)
        customerBirdsSold: { type: Number, default: 0 }, // Only customer sales birds (for display)
        customerWeightSold: { type: Number, default: 0 }, // Only customer sales weight (for display)
        totalExpenses: { type: Number, default: 0 },
        totalDieselAmount: { type: Number, default: 0 },
        totalLosses: { type: Number, default: 0 }, // Total losses from death birds
        totalBirdsPurchased: { type: Number, default: 0 },
        totalBirdsSold: { type: Number, default: 0 },
        totalBirdsLost: { type: Number, default: 0 }, // Total birds lost
        totalWeightPurchased: { type: Number, default: 0 },
        totalWeightSold: { type: Number, default: 0 },
        totalWeightLost: { type: Number, default: 0 }, // Total weight lost
        birdWeightLoss: { type: Number, default: 0 }, // Calculated: purchased - sold - stock - death
        birdsRemaining: { type: Number, default: 0 }, // Birds left after sales
        mortality: { type: Number, default: 0 }, // Birds that died
        birdsTransferred: { type: Number, default: 0 }, // Birds transferred to other trips
        weightTransferred: { type: Number, default: 0 }, // Weight transferred to other trips
        netProfit: { type: Number, default: 0 },
        totalProfitMargin: { type: Number, default: 0 }, // Total profit from sales only
        totalCashPaid: { type: Number, default: 0 }, // Total cash payments received
        totalOnlinePaid: { type: Number, default: 0 }, // Total online payments received
        totalDiscount: { type: Number, default: 0 }, // Total discounts given
        totalReceivedAmount: { type: Number, default: 0 }, // Total amount received (cash + online)
        profitPerKg: { type: Number, default: 0 },
        fuelEfficiency: { type: Number, default: 0 },
        avgPurchaseRate: { type: Number, default: 0 }, // Average purchase rate for calculations
        birdsProfit: { type: Number, default: 0 }, // Birds profit: Total Sales - Total Purchases - Total Expenses - Gross Rent
        grossRent: { type: Number, default: 0 }, // Gross rent: rentPerKm * totalDistance
        tripProfit: { type: Number, default: 0 } // Trip profit: netRent + birdsProfit
    },

    status: { 
        type: String, 
        enum: ['started', 'ongoing', 'completed'], 
        default: 'started' 
    },

    // Trip type for transfer tracking
    type: {
        type: String,
        enum: ['original', 'transferred'],
        default: 'original'
    },

    // Transfer relationships
    transferredFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip' },
    transferredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Trip' }],

    // Transfer history for audit trail
    transferHistory: [{
        transferredTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
        transferredToSupervisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        transferredStock: {
            birds: { type: Number, required: true },
            weight: { type: Number, required: true },
            avgWeight: { type: Number, required: true },
            rate: { type: Number, required: true }
        },
        reason: { type: String, required: true },
        transferredAt: { type: Date, default: Date.now },
        transferredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
    }],

    // Trip completion details
    completionDetails: {
        completedAt: Date,
        closingOdometer: Number,
        finalRemarks: String,
        supervisorSignature: String // Could be a signature image or text
    },

    // Audit fields
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }

}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform(doc, ret) {
            ret.id = ret._id;
            delete ret._id;
            delete ret.__v;

            if (ret.diesel?.stations?.length) {
                ret.diesel.stations = ret.diesel.stations.map((station) => {
                    const stationName = station.stationName || station.name || '';
                    return {
                        ...station,
                        stationName,
                        name: station.name || stationName
                    };
                });
            }

            return ret;
        }
    },
    toObject: { virtuals: true }
});

// Pre-save middleware to generate tripId if not provided
tripSchema.pre('save', async function(next) {
    // Generate tripId if not provided (always generate for new trips)
    if (this.isNew && !this.tripId) {
        try {
            const sequenceValue = await Sequence.getNextValue('tripId');
            // Generate 4-6 digit number (pad with zeros if needed, max 6 digits)
            const tripNumber = String(sequenceValue).padStart(4, '0').slice(0, 6);
            this.tripId = `TRP-${tripNumber}`;
        } catch (error) {
            return next(error);
        }
    }
    
    // Ensure tripId is set (fallback if sequence fails)
    if (!this.tripId) {
        const fallbackNumber = String(Date.now()).slice(-6);
        this.tripId = `TRP-${fallbackNumber}`;
    }

    // Calculate average weights
    if (this.purchases && this.purchases.length > 0) {
        this.purchases.forEach(purchase => {
            if (purchase.birds && purchase.weight) {
                purchase.avgWeight = Number((purchase.weight / purchase.birds).toFixed(2));
            }
        });
    }

    if (this.diesel?.stations?.length) {
        this.diesel.stations.forEach((station) => {
            const stationName = station.stationName || station.name || '';
            station.stationName = stationName;
            if (!station.name && stationName) {
                station.name = stationName;
            }
        });
    }

    // Calculate summary statistics FIRST (before avgPurchaseRate calculation)
    if (this.purchases && this.purchases.length > 0) {
        this.summary.totalPurchaseAmount = this.purchases.reduce((sum, purchase) => sum + (purchase.amount || 0), 0);
        this.summary.totalBirdsPurchased = this.purchases.reduce((sum, purchase) => sum + (purchase.birds || 0), 0);
        this.summary.totalWeightPurchased = this.purchases.reduce((sum, purchase) => sum + (purchase.weight || 0), 0);
    }

    // Calculate average purchase rate for profit calculations (needed for sales, stock, and transfers)
    // Formula: avg rate = total purchase cost / total purchase weight
    const avgPurchaseRate = this.summary.totalWeightPurchased > 0 ? 
        this.summary.totalPurchaseAmount / this.summary.totalWeightPurchased : 0;
    this.summary.avgPurchaseRate = Number(avgPurchaseRate.toFixed(2));

    if (this.sales && this.sales.length > 0) {
        // Get vendor name from first purchase (if purchases exist)
        let firstVendorName = '';
        if (this.purchases && this.purchases.length > 0) {
            const firstPurchase = this.purchases[0];
            
            // For transferred trips, check if vendorName is stored in purchase record
            if (this.type === 'transferred' && firstPurchase.vendorName) {
                firstVendorName = firstPurchase.vendorName;
            } else if (firstPurchase.supplier) {
                // Check if supplier is populated (object with vendorName property)
                if (typeof firstPurchase.supplier === 'object' && firstPurchase.supplier.vendorName) {
                    // Supplier is already populated
                    firstVendorName = firstPurchase.supplier.vendorName || firstPurchase.supplier.name || '';
                } else if (typeof firstPurchase.supplier === 'object' && firstPurchase.supplier.toString) {
                    // Supplier is an ObjectId, need to fetch it
                    try {
                        const Vendor = mongoose.model('Vendor');
                        const vendor = await Vendor.findById(firstPurchase.supplier);
                        if (vendor) {
                            firstVendorName = vendor.vendorName || vendor.name || '';
                        }
                    } catch (error) {
                        console.error('Error fetching vendor in pre-save middleware:', error);
                    }
                }
            }
        }

        // Process sales sequentially to ensure proper async handling
        for (let i = 0; i < this.sales.length; i++) {
            const sale = this.sales[i];
            
            if (sale.birds && sale.weight) {
                sale.avgWeight = Number((sale.weight / sale.birds).toFixed(2));
            }
            
            // Set product (vendor name) from first purchase if not already set
            if (!sale.product && firstVendorName) {
                sale.product = firstVendorName;
            }
            
            // Calculate profit margin and profit amount
            sale.profitMargin = Number((sale.rate - avgPurchaseRate).toFixed(2));
            sale.profitAmount = Number((sale.profitMargin * sale.weight).toFixed(2));
            // Calculate receivedAmount from cashPaid + onlinePaid
            sale.receivedAmount = (sale.cashPaid || 0) + (sale.onlinePaid || 0);
            
            // Calculate Outstanding Balance - preserve sequential balances if already calculated
            // Sequential balances (balanceForSale, balanceForCashPaid, balanceForOnlinePaid, balanceForDiscount)
            // are calculated in the controller for proper sequential accounting
            if (sale.client) {
                try {
                    const Customer = mongoose.model('Customer');
                    const customer = await Customer.findById(sale.client);
                    if (customer) {
                        const globalOutstandingBalance = customer.outstandingBalance || 0;
                        const totalPaid = (sale.onlinePaid || 0) + (sale.cashPaid || 0);
                        const discount = sale.discount || 0;
                        
                        // Check if this is a receipt entry (birds = 0, weight = 0, amount typically 0)
                        const isReceipt = (sale.birds === 0 || !sale.birds) && 
                                          (sale.weight === 0 || !sale.weight) && 
                                          (sale.amount === 0 || !sale.amount);
                        
                        // If sequential balances are not already set, calculate them
                        // (This happens when data is loaded from DB and saved again)
                        if (sale.balanceForSale === undefined || sale.balanceForSale === null) {
                            if (isReceipt) {
                                // For receipts: No amount is added, only payments are subtracted
                                sale.balanceForSale = Number(globalOutstandingBalance.toFixed(2));
                                const balanceForCashPaid = globalOutstandingBalance - (sale.cashPaid || 0);
                                sale.balanceForCashPaid = Number(Math.max(0, balanceForCashPaid).toFixed(2));
                                const balanceForOnlinePaid = balanceForCashPaid - (sale.onlinePaid || 0);
                                sale.balanceForOnlinePaid = Number(Math.max(0, balanceForOnlinePaid).toFixed(2));
                                const balanceForDiscount = balanceForOnlinePaid - discount;
                                sale.balanceForDiscount = Number(Math.max(0, balanceForDiscount).toFixed(2));
                            } else {
                                // For regular sales: Add sale amount, then subtract payments
                                const balanceForSale = globalOutstandingBalance + sale.amount;
                                sale.balanceForSale = Number(balanceForSale.toFixed(2));
                                const balanceForCashPaid = balanceForSale - (sale.cashPaid || 0);
                                sale.balanceForCashPaid = Number(balanceForCashPaid.toFixed(2));
                                const balanceForOnlinePaid = balanceForCashPaid - (sale.onlinePaid || 0);
                                sale.balanceForOnlinePaid = Number(balanceForOnlinePaid.toFixed(2));
                                const balanceForDiscount = balanceForOnlinePaid - discount;
                                sale.balanceForDiscount = Number(Math.max(0, balanceForDiscount).toFixed(2));
                            }
                        }
                        
                        // Calculate the final balance after this sale/receipt (use balanceForDiscount if available)
                        let balance = sale.balanceForDiscount !== undefined && sale.balanceForDiscount !== null 
                                     ? sale.balanceForDiscount 
                                     : (globalOutstandingBalance + sale.amount - totalPaid - discount);
                        
                        // If payment exceeds the sale amount + current outstanding balance, 
                        // the extra payment reduces the balance to 0 (minimum)
                        balance = Math.max(0, balance);
                        
                        sale.balance = balance;
                        
                        // Note: Customer's global outstanding balance will be updated via API call from trip controller
                    }
                } catch (error) {
                    console.error('Error calculating outstanding balance:', error);
                }
            }
        }
    }

    // Calculate losses fields
    if (this.losses && this.losses.length > 0) {
        const avgPurchaseRate = this.summary.avgPurchaseRate || 0;
        this.losses.forEach(loss => {
            if (loss.quantity && loss.weight) {
                loss.avgWeight = Number((loss.weight / loss.quantity).toFixed(2));
            }
            // Ensure rate uses average purchase rate (formula: total purchase cost / total purchase weight)
            if (avgPurchaseRate > 0) {
                loss.rate = Number(avgPurchaseRate.toFixed(2));
            }
            // Calculate total loss using average purchase rate
            if (loss.weight && avgPurchaseRate > 0) {
                loss.total = Number((loss.weight * avgPurchaseRate).toFixed(2));
            }
        });
    }

    // Calculate customer sales totals
    let customerSalesAmount = 0;
    let customerBirdsSold = 0;
    let customerWeightSold = 0;
    let customerProfitMargin = 0;
    let customerCashPaid = 0;
    let customerOnlinePaid = 0;
    let customerDiscount = 0;
    let customerReceivedAmount = 0;

    if (this.sales && this.sales.length > 0) {
        customerSalesAmount = this.sales.reduce((sum, sale) => sum + (sale.amount || 0), 0);
        customerBirdsSold = this.sales.reduce((sum, sale) => sum + (sale.birds || 0), 0);
        customerWeightSold = this.sales.reduce((sum, sale) => sum + (sale.weight || 0), 0);
        customerProfitMargin = this.sales.reduce((sum, sale) => sum + (sale.profitAmount || 0), 0);
        customerCashPaid = this.sales.reduce((sum, sale) => sum + (sale.cashPaid || 0), 0);
        customerOnlinePaid = this.sales.reduce((sum, sale) => sum + (sale.onlinePaid || 0), 0);
        customerDiscount = this.sales.reduce((sum, sale) => sum + (sale.discount || 0), 0);
        customerReceivedAmount = this.sales.reduce((sum, sale) => sum + (sale.receivedAmount || 0), 0);
    }

    if (this.expenses && this.expenses.length > 0) {
        this.summary.totalExpenses = this.expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);
    }

    if (this.diesel && this.diesel.stations && this.diesel.stations.length > 0) {
        this.summary.totalDieselAmount = this.diesel.stations.reduce((sum, station) => sum + (station.amount || 0), 0);
    }

    if (this.losses && this.losses.length > 0) {
        this.summary.totalLosses = this.losses.reduce((sum, loss) => sum + (loss.total || 0), 0);
        this.summary.totalBirdsLost = this.losses.reduce((sum, loss) => sum + (loss.quantity || 0), 0);
        this.summary.totalWeightLost = this.losses.reduce((sum, loss) => sum + (loss.weight || 0), 0);
        this.summary.mortality = this.summary.totalBirdsLost;
    }

    // Calculate total stock birds and weight from stocks array
    const totalStockBirds = this.stocks.reduce((sum, stock) => sum + (stock.birds || 0), 0);
    const totalStockWeight = this.stocks.reduce((sum, stock) => sum + (stock.weight || 0), 0);
    const totalStockValue = this.stocks.reduce((sum, stock) => sum + (stock.value || 0), 0);

    // Calculate total transferred birds, weight, and sales amount from transfer history
    const totalTransferredBirds = this.transferHistory.reduce((sum, transfer) => sum + (transfer.transferredStock?.birds || 0), 0);
    const totalTransferredWeight = this.transferHistory.reduce((sum, transfer) => sum + (transfer.transferredStock?.weight || 0), 0);
    const totalTransferredSalesAmount = this.transferHistory.reduce((sum, transfer) => {
        const stock = transfer.transferredStock;
        if (stock && stock.rate && stock.weight) {
            return sum + (stock.rate * stock.weight);
        }
        return sum;
    }, 0);
    
    // Calculate transfer profit margin (rate * weight - purchase cost)
    const totalTransferredProfitMargin = this.transferHistory.reduce((sum, transfer) => {
        const stock = transfer.transferredStock;
        if (stock && stock.rate && stock.weight) {
            const profitMargin = stock.rate - avgPurchaseRate;
            return sum + (profitMargin * stock.weight);
        }
        return sum;
    }, 0);

    this.summary.birdsTransferred = totalTransferredBirds;
    this.summary.weightTransferred = totalTransferredWeight;

    // Calculate stock profit margin (value - purchase cost)
    const totalStockProfitMargin = this.stocks.reduce((sum, stock) => {
        if (stock.value && stock.weight && avgPurchaseRate > 0) {
            const purchaseCost = stock.weight * avgPurchaseRate;
            return sum + (stock.value - purchaseCost);
        }
        return sum;
    }, 0);

    // Store customer-only sales for display in SALES DETAILS section
    this.summary.customerSalesAmount = customerSalesAmount;
    this.summary.customerBirdsSold = customerBirdsSold;
    this.summary.customerWeightSold = customerWeightSold;
    
    // TOTAL SALES AMOUNT = Customer Sales + Stock Sales + Transfer Sales (for financial calculations)
    this.summary.totalSalesAmount = customerSalesAmount + totalStockValue + totalTransferredSalesAmount;
    
    // TOTAL BIRDS SOLD = Customer Sales + Stock + Transfers (for inventory tracking)
    this.summary.totalBirdsSold = customerBirdsSold + totalStockBirds + totalTransferredBirds;
    
    // TOTAL WEIGHT SOLD = Customer Sales + Stock + Transfers (for inventory tracking)
    this.summary.totalWeightSold = customerWeightSold + totalStockWeight + totalTransferredWeight;
    
    // TOTAL PROFIT MARGIN = Customer Profit + Stock Profit + Transfer Profit
    this.summary.totalProfitMargin = customerProfitMargin + totalStockProfitMargin + totalTransferredProfitMargin;
    
    // Payment fields (only from customer sales, not stock/transfers)
    this.summary.totalCashPaid = customerCashPaid;
    this.summary.totalOnlinePaid = customerOnlinePaid;
    this.summary.totalDiscount = customerDiscount;
    this.summary.totalReceivedAmount = customerReceivedAmount;

    // Calculate bird weight loss: purchased - sold (includes customer + stock + transfers) - death
    this.summary.birdWeightLoss = (this.summary.totalWeightPurchased || 0) - 
                                 (this.summary.totalWeightSold || 0) - 
                                 (this.summary.totalWeightLost || 0);

    // Calculate birds remaining: purchased - sold (includes customer + stock + transfers) - lost
    this.summary.birdsRemaining = (this.summary.totalBirdsPurchased || 0) - 
                                 (this.summary.totalBirdsSold || 0) - 
                                 (this.summary.totalBirdsLost || 0);

    // Calculate gross rent: rentPerKm * totalDistance
    const totalDistance = this.vehicleReadings?.totalDistance || 0;
    this.summary.grossRent = (this.rentPerKm || 0) * totalDistance;

    // Calculate birds profit: Total Sales - Total Purchases - Total Expenses - Gross Rent
    this.summary.birdsProfit = (this.summary.totalSalesAmount || 0) - 
                              (this.summary.totalPurchaseAmount || 0) - 
                              (this.summary.totalExpenses || 0) - 
                              this.summary.grossRent;

    // Calculate net profit from sales profit margin minus expenses and diesel
    const salesProfit = this.summary.totalProfitMargin || 0;
    const totalExpenses = (this.summary.totalExpenses || 0) + (this.summary.totalDieselAmount || 0);
    const totalLosses = this.summary.totalLosses || 0;
    this.summary.netProfit = salesProfit - totalExpenses - totalLosses;

    // Calculate net rent: grossRent - dieselCost
    const netRent = (this.summary.grossRent || 0) - (this.summary.totalDieselAmount || 0);

    // Calculate trip profit: netRent + birdsProfit
    this.summary.tripProfit = Number(((netRent || 0) + (this.summary.birdsProfit || 0)).toFixed(2));

    // Validate vehicle readings if closing reading is provided
    if (this.vehicleReadings.opening && this.vehicleReadings.closing) {
        if (this.vehicleReadings.closing < this.vehicleReadings.opening) {
            return next(new Error('Closing odometer reading must be greater than opening reading'));
        }
        this.vehicleReadings.totalDistance = this.vehicleReadings.closing - this.vehicleReadings.opening;
    }

    next();
});

const Trip = mongoose.model('Trip', tripSchema);

export default Trip;