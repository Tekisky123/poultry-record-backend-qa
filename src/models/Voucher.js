import mongoose from "mongoose";

const voucherSchema = new mongoose.Schema({
  voucherNumber: {
    type: Number,
    required: true,
    unique: true,
    min: [1, "Voucher number must be greater than zero"]
  },
  voucherType: {
    type: String,
    required: true,
    enum: ['Sales', 'Purchase', 'Payment', 'Receipt', 'Contra', 'Journal']
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  party: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer', // Can reference Customer or Vendor
    required: false // Optional for some voucher types
  },
  partyName: {
    type: String,
    required: false,
    trim: true
  },
  // For Payment/Receipt vouchers - multiple parties
  parties: [{
    partyId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false
    },
    partyType: {
      type: String,
      enum: ['customer', 'ledger', 'vendor'],
      required: false
    },
    amount: {
      type: Number,
      default: 0,
      min: [0, "Amount cannot be negative"]
    }
  }],
  // For Payment/Receipt vouchers - selected account ledger
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ledger',
    required: false
  },
  entries: [{
    account: {
      type: String,
      required: true,
      trim: true
    },
    debitAmount: {
      type: Number,
      default: 0,
      min: [0, "Debit amount cannot be negative"]
    },
    creditAmount: {
      type: Number,
      default: 0,
      min: [0, "Credit amount cannot be negative"]
    },
    narration: {
      type: String,
      trim: true,
      maxlength: [500, "Narration cannot exceed 500 characters"]
    }
  }],
  totalDebit: {
    type: Number,
    default: 0,
    min: [0, "Total debit cannot be negative"]
  },
  totalCredit: {
    type: Number,
    default: 0,
    min: [0, "Total credit cannot be negative"]
  },
  narration: {
    type: String,
    trim: true,
    maxlength: [500, "Narration cannot exceed 500 characters"]
  },
  isActive: {
    type: Boolean,
    default: true
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

// Pre-save middleware to generate entries for Payment/Receipt vouchers and calculate totals
voucherSchema.pre('save', async function(next) {
  // For Payment/Receipt vouchers, generate entries from parties and account
  if ((this.voucherType === 'Payment' || this.voucherType === 'Receipt') && this.parties && this.parties.length > 0 && this.account) {
    this.entries = [];
    
    // Get account ledger name
    const Ledger = mongoose.model('Ledger');
    const accountLedger = await Ledger.findById(this.account);
    const accountName = accountLedger ? accountLedger.name : 'Account';
    
    // For each party, create an entry
    for (let party of this.parties) {
      if (party.amount > 0) {
        // Get party name
        let partyName = '';
        if (party.partyType === 'customer') {
          const Customer = mongoose.model('Customer');
          const customer = await Customer.findById(party.partyId);
          partyName = customer ? (customer.shopName || customer.ownerName || 'Customer') : 'Customer';
        } else if (party.partyType === 'ledger') {
          const Ledger = mongoose.model('Ledger');
          const ledger = await Ledger.findById(party.partyId);
          partyName = ledger ? ledger.name : 'Ledger';
        } else if (party.partyType === 'vendor') {
          const Vendor = mongoose.model('Vendor');
          const vendor = await Vendor.findById(party.partyId);
          partyName = vendor ? vendor.vendorName : 'Vendor';
        }
        
        if (this.voucherType === 'Payment') {
          // Payment: Debit party, Credit account
          this.entries.push({
            account: partyName,
            debitAmount: party.amount,
            creditAmount: 0
          });
        } else if (this.voucherType === 'Receipt') {
          // Receipt: Debit account, Credit party
          this.entries.push({
            account: partyName,
            debitAmount: 0,
            creditAmount: party.amount
          });
        }
      }
    }
    
    // Add account entry
    const totalAmount = this.parties.reduce((sum, p) => sum + (p.amount || 0), 0);
    if (this.voucherType === 'Payment') {
      // Payment: Credit account (money going out)
      this.entries.push({
        account: accountName,
        debitAmount: 0,
        creditAmount: totalAmount
      });
    } else if (this.voucherType === 'Receipt') {
      // Receipt: Debit account (money coming in)
      this.entries.push({
        account: accountName,
        debitAmount: totalAmount,
        creditAmount: 0
      });
    }
  }
  
  // Calculate total debit and credit
  this.totalDebit = this.entries.reduce((sum, entry) => sum + (entry.debitAmount || 0), 0);
  this.totalCredit = this.entries.reduce((sum, entry) => sum + (entry.creditAmount || 0), 0);
  
  // Validate that debit equals credit (skip if no entries for Payment/Receipt vouchers being created)
  if (this.entries.length > 0 && Math.abs(this.totalDebit - this.totalCredit) > 0.01) {
    return next(new Error('Total debit amount must equal total credit amount'));
  }
  
  // Validate that each entry has either debit or credit, not both
  for (let entry of this.entries) {
    if (entry.debitAmount > 0 && entry.creditAmount > 0) {
      return next(new Error('Each entry must have either debit or credit amount, not both'));
    }
    if (entry.debitAmount === 0 && entry.creditAmount === 0 && this.entries.length > 0) {
      return next(new Error('Each entry must have either debit or credit amount'));
    }
  }
  
  next();
});

// Index for better query performance
voucherSchema.index({ voucherNumber: 1 });
voucherSchema.index({ voucherType: 1 });
voucherSchema.index({ date: -1 });
voucherSchema.index({ party: 1 });

const Voucher = mongoose.model("Voucher", voucherSchema);

export default Voucher;
