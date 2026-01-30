import mongoose from 'mongoose';
import connectDB from '../configs/database.js';
import Group from '../models/Group.js';
import User from '../models/User.js';
import { config } from 'dotenv';
import path from 'path';

// Load environment variables
config({ path: path.join(process.cwd(), 'src', '.env') });

const slugify = (text) => {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[\s\W-]+/g, '-')
        .replace(/^-+|-+$/g, '');
};

const defaultGroups = [
    // Liability
    { name: 'Loans (Liability)', type: 'Liability' },
    { name: 'Current Liabilities', type: 'Liability' },

    // Assets
    { name: 'Fixed Assets', type: 'Assets' },
    { name: 'Investments', type: 'Assets' },
    { name: 'Current Assets', type: 'Assets' },
    { name: 'Suspense A/c', type: 'Assets' },

    // Income
    { name: 'Sales Accounts', type: 'Income' },
    { name: 'Closing Stock', type: 'Income' },
    { name: 'Indirect Income', type: 'Income' },

    // Expenses
    { name: 'Purchase Accounts', type: 'Expenses' },
    { name: 'Opening Stock', type: 'Expenses' },
    { name: 'Direct Expenses', type: 'Expenses' },
    { name: 'Indirect Expenses', type: 'Expenses' }
];

const childGroupsToAdd = [
    { name: 'BANK ACCOUNTS', type: 'Assets', parentSlug: 'current-assets' },
    { name: 'CASH A/C', type: 'Assets', parentSlug: 'current-assets' }
];

const addParentGroups = async () => {
    try {
        await connectDB();
        console.log('Connected to Database');

        // Find a system user (Superadmin or Admin) to attribute creation to
        const adminUser = await User.findOne({ role: { $in: ['superadmin', 'admin'] } });

        if (!adminUser) {
            console.error('No Admin/Superadmin user found. Please create a user first.');
            process.exit(1);
        }

        console.log(`Using user: ${adminUser.name} (${adminUser.role}) for creation attribution.`);

        let createdCount = 0;
        let skippedCount = 0;

        // 1. Create Parent Groups
        console.log('\n--- Processing Parent Groups ---');
        for (const groupData of defaultGroups) {
            const expectedSlug = slugify(groupData.name);

            // Check if group already exists (by slug)
            const existingGroup = await Group.findOne({ slug: expectedSlug });

            if (existingGroup) {
                console.log(`Group "${groupData.name}" (slug: ${expectedSlug}) already exists. Skipping.`);
                skippedCount++;
                continue;
            }

            // Create new group
            const newGroup = new Group({
                ...groupData,
                parentGroup: null, // These are root groups
                isPredefined: true,
                createdBy: adminUser._id,
                updatedBy: adminUser._id,
                isActive: true
            });

            await newGroup.save();
            console.log(`Created group: "${newGroup.name}" (${newGroup.type})`);
            createdCount++;
        }

        // 2. Create Child Groups
        console.log('\n--- Processing Child Groups ---');
        for (const childData of childGroupsToAdd) {
            const { parentSlug, ...data } = childData;
            const expectedSlug = slugify(data.name);

            // Find parent
            const parentGroup = await Group.findOne({ slug: parentSlug });
            if (!parentGroup) {
                console.error(`Parent group with slug "${parentSlug}" not found. skipping child "${data.name}".`);
                continue;
            }

            // Check if child exists
            const existingChild = await Group.findOne({ slug: expectedSlug });
            if (existingChild) {
                console.log(`Child Group "${data.name}" (slug: ${expectedSlug}) already exists. Skipping.`);
                skippedCount++;
                continue;
            }

            // Create child group
            const newChildGroup = new Group({
                ...data,
                parentGroup: parentGroup._id,
                isPredefined: true,
                createdBy: adminUser._id,
                updatedBy: adminUser._id,
                isActive: true
            });

            await newChildGroup.save();
            console.log(`Created child group: "${newChildGroup.name}" under "${parentGroup.name}"`);
            createdCount++;
        }

        console.log('\nSummary:');
        console.log(`- Created: ${createdCount}`);
        console.log(`- Skipped: ${skippedCount}`);

        process.exit(0);
    } catch (error) {
        console.error('Error adding groups:', error);
        process.exit(1);
    }
};

addParentGroups();
