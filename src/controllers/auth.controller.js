import User from "../models/User.js";
import Customer from "../models/Customer.js";
import Group from "../models/Group.js";
import mongoose from "mongoose";
import AppError from "../utils/AppError.js";
import validator from 'validator';
import { loginValidator, signupValidator } from '../utils/validators.js';
import { successResponse } from "../utils/responseHandler.js";
import bcrypt from 'bcrypt';
import { config } from 'dotenv';
config({ path: `${process.cwd()}/src/.env` });

const cookieConfig = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // NONE for cross-site
  maxAge: 365 * 24 * 60 * 60 * 1000, // one year
}

export const signup = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    signupValidator(req.body);

    const { mobileNumber, role, email, password: inputPassword, gstOrPanNumber, place, ...otherFields } = req.body;

    // Check if user already exists (email or mobile)
    const existingUser = await User.findOne({
      $or: [
        { email: email }, // only check email if provided
        { mobileNumber: mobileNumber }
      ]
    }).session(session);

    if (existingUser) {
      throw new AppError('User with this email or mobile number already exists', 400);
    }

    const hashPassword = await bcrypt.hash(inputPassword, 10);

    const user = new User({
      ...req.body,
      password: hashPassword,
      approvalStatus: 'pending' // All users start as pending, including customers
    });

    const savedUser = await user.save({ session });

    // If role is customer, create Customer record with GST/PAN information
    if (role === 'customer') {
      const customer = new Customer({
        shopName: savedUser.name, // Use user name as shop name initially
        ownerName: savedUser.name,
        contact: savedUser.mobileNumber,
        address: otherFields.address || '',
        gstOrPanNumber: gstOrPanNumber,
        place: place || '',
        createdBy: savedUser._id, // Self-created during signup
        updatedBy: savedUser._id,
        user: savedUser._id,
        // Set both balances to 0 for signup customers
        openingBalance: 0,
        outstandingBalance: 0
      });

      const savedCustomer = await customer.save({ session });

      // Update User with customer reference
      savedUser.customer = savedCustomer._id;
      await savedUser.save({ session });
    }

    await session.commitTransaction();

    const { password, ...otherData } = savedUser.toObject();

    successResponse(res, "signup successfull!!", 201, otherData);
  } catch (error) {
    console.log("signup next err", error)
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    next(error);
  } finally {
    session.endSession();
  }
};

export const login = async (req, res, next) => {
  try {
    // Validate request body
    loginValidator(req.body);
    const { username, password: inputPassword } = req.body;

    const query = { isActive: true };

    if (validator.isEmail(username)) {
      query.email = username.toLowerCase();
    } else if (validator.isMobilePhone(`+91${username.toString()}`, "any", { strictMode: true })) {
      query.mobileNumber = `+91${username.toString()}`;
    } else {
      throw new AppError("Username must be a valid email or mobile number", 400);
    }
    // Check if user exists and is active
    const user = await User.findOne(query);

    if (!user) throw new AppError('Invalid credentials', 401);
    // Require approval for admin/supervisor before allowing login
    if ((user.role === 'admin' || user.role === 'supervisor' || user.role === 'customer') && user.approvalStatus !== 'approved') {
      throw new AppError(`Account approval is ${user.approvalStatus || "pending"}`, 403);
    }
    // Check password
    const validPassword = await user.validatePassword(inputPassword);
    if (!validPassword) throw new AppError('Invalid credentials', 401);
    // Update last login timestamp
    user.lastLogin = new Date();
    await user.save();
    // Generate JWT
    const token = await user.getJWT();

    const { password, ...otherData } = user.toObject();

    // Set cookie
    res.cookie('token', token, cookieConfig);

    // Send success response with token included
    successResponse(res, 'Login successful!!', 200, { ...otherData, token });

  } catch (error) {
    next(error);
  }
};

export const logout = async (req, res, next) => {
  try {
    res.cookie("token", null, { expires: new Date(Date.now()) });

    successResponse(res, "logout successfull!!");
  } catch (error) {
    next(error);
  }
};

export const getVerifiedUser = async (req, res, next) => {
  try {
    // req.user has the token payload. Use the ID to fetch fresh data.
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      throw new AppError('User not found', 404);
    }
    successResponse(res, 'Fetch verified user', 200, user);
  } catch (error) {
    next(error)
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    if (!currentPassword || !newPassword) {
      throw new AppError('Current password and new password are required', 400);
    }

    // Validate new password strength
    if (!validator.isStrongPassword(newPassword, {
      minLength: 6,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 0
    })) {
      throw new AppError('New password must contain at least one uppercase letter, one lowercase letter, and one number', 400);
    }

    // Find user and verify current password
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      throw new AppError('Current password is incorrect', 400);
    }

    // Hash new password and update
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(userId, { password: hashedNewPassword });

    successResponse(res, "Password changed successfully", 200, {});
  } catch (error) {
    next(error);
  }
};