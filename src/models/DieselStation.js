import mongoose from "mongoose";

const dieselStationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Station name is required"],
    trim: true,
    minlength: [2, "Station name must be at least 2 characters"],
    maxlength: [100, "Station name cannot exceed 100 characters"],
  },
  location: {
    type: String,
    trim: true,
    maxlength: [200, "Location cannot exceed 200 characters"],
    default: '',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
},
{
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

export default mongoose.model("DieselStation", dieselStationSchema);

