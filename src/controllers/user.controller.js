import User from "../models/User.js";
import Customer from "../models/Customer.js";
import Group from "../models/Group.js";
import { successResponse } from "../utils/responseHandler.js";
import AppError from "../utils/AppError.js";
import { signupValidator } from "../utils/validators.js";
import bcrypt from 'bcrypt';


export const getUsers = async (req, res, next) => {
    try {
        const users = await User.find({
            isActive: true,
            approvalStatus: 'approved',
            role: { $ne: 'customer' } // Exclude customers from users list
        })
            .select('-password')
            .sort({ createdAt: -1 });
        successResponse(res, "users", 200, users)
    } catch (error) {
        next(error);
    }
};

export const addUser = async (req, res, next) => {
    try {
        signupValidator(req.body);

        const { mobileNumber, role, email, password: inputPassword } = req.body;

        // Check if user already exists (email or mobile)
        const existingUser = await User.findOne({
            $or: [
                { email: email }, // only check email if provided
                { mobileNumber: mobileNumber }
            ]
        });

        if (existingUser) {
            throw new AppError('User with this email or mobile number already exists', 400);
        }

        const hashPassword = await bcrypt.hash(inputPassword, 10);

        const user = new User({
            ...req.body,
            password: hashPassword,
            approvalStatus: role === 'customer' ? 'approved' : 'pending'
        });

        const savedUser = await user.save();

        const { password, ...otherData } = savedUser.toObject();

        successResponse(res, "New user added successfully", 200, otherData)
    } catch (error) {
        next(error);
    }
};

export const getUserById = async (req, res, next) => {
    const { id } = req?.params;
    try {
        const user = await User.findOne({ _id: id, isActive: true })
            .select('-password')
            .sort({ createdAt: -1 });
        successResponse(res, "user", 200, user)
    } catch (error) {
        next(error);
    }
};

export const getPendingApprovals = async (req, res, next) => {
    try {
        // superadmin sees pending admins, supervisors, and customers; admin sees pending supervisors and customers
        const role = req.user.role;
        let query = { approvalStatus: 'pending' };
        if (role === 'superadmin') {
            query.role = { $in: ['admin', 'supervisor', 'customer'] };
        } else if (role === 'admin') {
            query.role = { $in: ['supervisor', 'customer'] };
        } else {
            return successResponse(res, "pending approvals", 200, []);
        }
        const users = await User.find(query).select('-password').sort({ createdAt: -1 });
        successResponse(res, "pending approvals", 200, users);
    } catch (error) {
        next(error);
    }
};

export const approveUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { group, openingBalance } = req.body;
        const approver = req.user;

        const user = await User.findById(id);
        if (!user) return next(new AppError('User not found', 404));

        // Permission: superadmin can approve admin and supervisor; admin can approve supervisor only
        const approverIsSuperAdmin = approver.role === 'superadmin';
        const approverIsAdmin = approver.role === 'admin';
        const targetIsAdmin = user.role === 'admin';
        const targetIsSupervisor = user.role === 'supervisor';
        const targetIsCustomer = user.role === 'customer';

        if (!((approverIsSuperAdmin && (targetIsAdmin || targetIsSupervisor || targetIsCustomer)) ||
            (approverIsAdmin && (targetIsSupervisor || targetIsCustomer)))) {
            return next(new AppError('Insufficient privileges', 403));
        }

        // For customers, validate that group is provided and exists
        if (targetIsCustomer) {
            if (!group) {
                return next(new AppError('Group is required for customer approval', 400));
            }

            // Validate that the group exists and is active
            const groupExists = await Group.findOne({ _id: group, isActive: true });
            if (!groupExists) {
                return next(new AppError('Invalid group. Group not found or inactive', 400));
            }
        }

        user.approvalStatus = 'approved';
        user.approvedBy = approver._id;
        user.approvedAt = new Date();
        await user.save();

        // If approved user is a customer, create customer record
        if (targetIsCustomer && !user.customer) {
            const customer = new Customer({
                shopName: user.name, // Use user name as shop name initially
                ownerName: user.name,
                contact: user.mobileNumber, // Sync mobile number from user
                address: user.address || '',
                group: group, // Set group from approval form
                openingBalance: openingBalance || 0, // Set opening balance from approval form
                user: user._id,
                createdBy: approver._id,
                updatedBy: approver._id
            });

            const savedCustomer = await customer.save();

            // Update user with customer reference
            user.customer = savedCustomer._id;
            await user.save();
        }

        const { password, ...publicUser } = user.toObject();
        successResponse(res, "user approved", 200, publicUser);
    } catch (error) {
        next(error);
    }
};

export const rejectUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const approver = req.user;

        const user = await User.findById(id);
        if (!user) return next(new AppError('User not found', 404));

        // Permission mirroring approve: superadmin can reject admin/supervisor; admin can reject supervisor
        const approverIsSuperAdmin = approver.role === 'superadmin';
        const approverIsAdmin = approver.role === 'admin';
        const targetIsAdmin = user.role === 'admin';
        const targetIsSupervisor = user.role === 'supervisor';

        if (!((approverIsSuperAdmin && (targetIsAdmin || targetIsSupervisor)) ||
            (approverIsAdmin && targetIsSupervisor))) {
            return next(new AppError('Insufficient privileges', 403));
        }

        user.approvalStatus = 'rejected';
        user.approvedBy = approver._id;
        user.approvedAt = new Date();
        await user.save();

        const { password, ...publicUser } = user.toObject();
        successResponse(res, "user rejected", 200, publicUser);
    } catch (error) {
        next(error);
    }
};

export const updateUser = async (req, res, next) => {
    const { id } = req?.params;
    const { name, email, mobileNumber, role, isActive, password, canManageStock } = req?.body;
    try {
        let updateData = { name, email, mobileNumber, role, isActive, canManageStock };

        if (password) {
            const hashPassword = await bcrypt.hash(password, 10);
            updateData.password = hashPassword;
        }

        const user = await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password');
        successResponse(res, "user", 200, user)
    } catch (error) {
        next(error);
    }
}

export const deleteUser = async (req, res, next) => {
    const { id } = req?.params;
    try {
        const user = await User.findByIdAndDelete(id);
        successResponse(res, "user deleted successfully!", 200, user)
    } catch (error) {
        next(error);
    }
}

export const updateUserStatus = async (req, res, next) => {
    const { id } = req?.params;
    const { isActive } = req?.body;
    try {
        const user = await User.findByIdAndUpdate(id, { isActive }, { new: true }).select('-password');
        successResponse(res, "user", 200, user)
    } catch (error) {
        next(error);
    }
}