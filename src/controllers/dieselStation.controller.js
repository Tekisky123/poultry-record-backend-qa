import DieselStation from "../models/DieselStation.js";
import AppError from "../utils/AppError.js";
import { successResponse } from "../utils/responseHandler.js";

export const createDieselStation = async (req, res, next) => {
  try {
    const stationData = {
      name: req.body.name,
      location: req.body.location,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    };

    const station = await DieselStation.create(stationData);
    successResponse(res, "Diesel station created successfully", 201, station);
  } catch (error) {
    next(error);
  }
};

export const getDieselStations = async (req, res, next) => {
  try {
    const stations = await DieselStation.find({ isActive: true }).sort({ name: 1 });
    successResponse(res, "Diesel stations fetched successfully", 200, stations);
  } catch (error) {
    next(error);
  }
};

export const updateDieselStation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = {
      name: req.body.name,
      location: req.body.location,
      updatedBy: req.user._id,
    };

    const station = await DieselStation.findOneAndUpdate(
      { _id: id, isActive: true },
      updateData,
      { new: true, runValidators: true }
    );

    if (!station) {
      throw new AppError("Diesel station not found", 404);
    }

    successResponse(res, "Diesel station updated successfully", 200, station);
  } catch (error) {
    next(error);
  }
};

export const deleteDieselStation = async (req, res, next) => {
  try {
    const { id } = req.params;

    const station = await DieselStation.findOneAndUpdate(
      { _id: id, isActive: true },
      { isActive: false, updatedBy: req.user._id },
      { new: true }
    );

    if (!station) {
      throw new AppError("Diesel station not found", 404);
    }

    successResponse(res, "Diesel station deleted successfully", 200, station);
  } catch (error) {
    next(error);
  }
};

