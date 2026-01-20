import Vehicle from "../models/Vehicle.js";
import AppError from "../utils/AppError.js";
import { successResponse } from "../utils/responseHandler.js";


export const addVehicle = async (req, res, next) => {
    try {
        const vehicleData = {
            ...req.body,
            createdBy: req.user._id,
            updatedBy: req.user._id
        };
        const vehicle = new Vehicle(vehicleData);
        await vehicle.save();

        successResponse(res, "New vehicle added", 201, vehicle)
    } catch (error) {
        next(error);
    }
};

export const getVehicles = async (req, res, next) => {
    try {
        const vehicles = await Vehicle.find({ isActive: true }).sort({ createdAt: -1 });
        successResponse(res, "vehicles", 200, vehicles)
    } catch (error) {
        next(error);
    }
};

export const getVehicleById = async (req, res, next) => {
    const { id } = req?.params;
    try {
        const vehicle = await Vehicle.findOne({ _id: id, isActive: true });
        successResponse(res, "vehicle", 200, vehicle)
    } catch (error) {
        next(error);
    }
};

export const updateVehicle = async (req, res, next) => {
    const { id } = req?.params;
    const data = req.body;
    try {
        const updateData = {
            ...data,
            updatedBy: req.user._id
        };
        
        const updatedVehicle = await Vehicle.findByIdAndUpdate(
            { _id: id }, 
            updateData, 
            { new: true, runValidators: true }
        );

        if (!updatedVehicle) {
            throw new AppError("Vehicle not found!", 404);
        }
        successResponse(res, "Vehicle updated!", 200, updatedVehicle)
    } catch (error) {
        next(error);
    }
};

export const deleteVehicle = async (req, res, next) => {
    const { id } = req?.params;
    try {
        const deletedVehicle = await Vehicle.findByIdAndUpdate(
            { _id: id },
            { isActive: false, updatedBy: req.user._id },
            { new: true }
        );

        if (!deletedVehicle) {
            throw new AppError("Vehicle not found!", 404);
        }

        successResponse(res, "Vehicle deleted!", 200, deletedVehicle)
    } catch (error) {
        next(error);
    }
};