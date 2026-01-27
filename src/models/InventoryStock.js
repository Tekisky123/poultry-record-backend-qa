
import mongoose from "mongoose";

const inventoryStockSchema = new mongoose.Schema({
  inventoryType: {
    type: String,
    enum: ["bird", "feed"],
    required: true
  },

  type: {
    type: String,
    enum: [
      "opening",
      "purchase",
      "sale",
      "mortality",
      "weight_loss",
      "consume",   // feed consume
      "receipt",
      "natural_weight_loss"
    ],
    required: true
  },

  // 🐔 Bird inventory fields
  birds: { type: Number, default: 0 },
  weight: { type: Number, default: 0 },

  // 🌾 Feed inventory fields
  feedQty: { type: Number, default: 0 }, // kg / bags
  bags: { type: Number, default: 0 },

  rate: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },

  tripId: { type: mongoose.Schema.Types.ObjectId, ref: "Trip" },

  refNo: String, // bill / dc / challan
  notes: String,

  supervisorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" },
  vehicleNumber: String,

  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },

  // Ledger tracking for Sales/Receipts
  cashLedgerId: { type: mongoose.Schema.Types.ObjectId, ref: "Ledger" },
  onlineLedgerId: { type: mongoose.Schema.Types.ObjectId, ref: "Ledger" },
  expenseLedgerId: { type: mongoose.Schema.Types.ObjectId, ref: "Ledger" },

  // Payment Details
  cashPaid: { type: Number, default: 0 },
  onlinePaid: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  balance: { type: Number, default: 0 }, // For Sale: Remaining balance of this transaction

  billNumber: String, // Similar to refNo but specific for sales

  date: { type: Date, required: true }
}, { timestamps: true });

const InventoryStock = mongoose.model("InventoryStock", inventoryStockSchema);

export default InventoryStock;
