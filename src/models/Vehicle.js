// models/Vehicle.js
import mongoose from "mongoose";
import validator from "validator";
import User from './User.js';

const vehicleSchema = new mongoose.Schema({
    vehicleNumber: {
        type: String,
        required: [true, 'Vehicle number is required'],
        unique: true,
        trim: true,
        uppercase: true,
        minlength: [2, 'Vehicle number too short'],
        maxlength: [50, 'Vehicle number too long'],
        validate: {
            validator: v => /^[A-Z0-9-\s]+$/.test(v),
            message: props => `${props.value} is not a valid vehicle number`
        }
    },

    type: {
        type: String,
        enum: ["pickup", "mini-truck", "truck", "tempo", "container", "trailer"],
        default: "truck",
    },

    fuelType: {
        type: String,
        enum: ["diesel", "petrol", "cng", "electric"],
    },

    insuranceEndDate: {
        type: Date,
        required: [true, 'Insurance end date is required']
    },

    pucEndDate: {
        type: Date,
        required: [true, 'PUC end date is required']
    },

    roadTaxEndDate: {
        type: Date,
        required: [true, 'Road tax end date is required']
    },

    fitnessEndDate: {
        type: Date,
        required: [true, 'Fitness end date is required']
    },

    nationalPermitEndDate: {
        type: Date,
        required: [true, 'National permit end date is required']
    },

    rentPerKm: {
        type: Number,
        required: [true, 'Rent per KM is required'],
        min: [0, 'Rent per KM cannot be negative']
    },

    currentStatus: {
        type: String,
        enum: ["idle", "in-transit", "maintenance"],
        default: "idle"
    },

    isActive: {
        type: Boolean,
        default: true
    },

    location: {
        type: {
            type: String,
            enum: ["Point"],
            default: "Point"
        },
        coordinates: {
            type: [Number],
            default: [0, 0],
            validate: {
                validator: arr => arr.length === 2 && arr.every(num => typeof num === "number"),
                message: "Coordinates must be [longitude, latitude]"
            }
        }
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
    }

}, {
    timestamps: true,
    strict: true,
    optimisticConcurrency: true,
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

vehicleSchema.pre('save', function (next) {
    if (this.vehicleNumber) {
        this.vehicleNumber = String(this.vehicleNumber).toUpperCase().trim();
    }
    next();
});

vehicleSchema.index({ vehicleNumber: 1 }, { unique: true });
vehicleSchema.index({ location: "2dsphere" });

const Vehicle = mongoose.model("Vehicle", vehicleSchema);

export default Vehicle;