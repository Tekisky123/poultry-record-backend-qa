import Group from '../models/Group.js';
import User from '../models/User.js';

// Standard Tally Prime 28 predefined groups
const predefinedGroups = [
    // Assets Groups
    { name: 'Branch / Divisions', type: 'Assets' },
    { name: 'Capital Account', type: 'Liability' },
    { name: 'Reserves & Surplus', type: 'Liability' },
    { name: 'Current Assets', type: 'Assets' },
    { name: 'Bank Accounts', type: 'Assets', parentName: 'Current Assets' },
    { name: 'Cash-in-Hand', type: 'Assets', parentName: 'Current Assets' },
    { name: 'Deposits (Asset)', type: 'Assets', parentName: 'Current Assets' },
    { name: 'Loans & Advances (Asset)', type: 'Assets', parentName: 'Current Assets' },
    { name: 'Stock-in-Hand', type: 'Assets', parentName: 'Current Assets' },
    { name: 'Sundry Debtors', type: 'Assets', parentName: 'Current Assets' },
    { name: 'Fixed Assets', type: 'Assets' },
    { name: 'Investments', type: 'Assets' },

    // Liability Groups
    { name: 'Current Liabilities', type: 'Liability' },
    { name: 'Bank OD A/c', type: 'Liability', parentName: 'Current Liabilities' },
    { name: 'Sundry Creditors', type: 'Liability', parentName: 'Current Liabilities' },
    { name: 'Duties & Taxes', type: 'Liability', parentName: 'Current Liabilities' },
    { name: 'Provisions', type: 'Liability', parentName: 'Current Liabilities' },
    { name: 'Loans (Liability)', type: 'Liability' },

    // Income Groups
    { name: 'Sales Accounts', type: 'Income' },
    { name: 'Indirect Income', type: 'Income' },
    { name: 'Direct Income', type: 'Income' },

    // Expenses Groups
    { name: 'Purchase Accounts', type: 'Expenses' },
    { name: 'Indirect Expenses', type: 'Expenses' },
    { name: 'Direct Expenses', type: 'Expenses' },

    // Additional common groups
    { name: 'Suspense A/c', type: 'Assets' },
    { name: 'Misc. Expenses (Asset)', type: 'Assets' },
    { name: 'Secured Loans', type: 'Liability', parentName: 'Loans (Liability)' },
    { name: 'Unsecured Loans', type: 'Liability', parentName: 'Loans (Liability)' },
];

const initializeGroups = async () => {
    try {
        console.log('🔄 Initializing predefined groups...');

        // Get or create a system user for predefined groups
        let systemUser = await User.findOne({ role: 'superadmin' });
        if (!systemUser) {
            // If no superadmin exists, try to get any admin user
            systemUser = await User.findOne({ role: 'admin' });
        }

        let systemUserId = null;
        if (systemUser) {
            systemUserId = systemUser._id;
        } else {
            console.log('⚠️  No admin user found. Predefined groups will be created without user reference.');
        }

        const createdGroups = [];
        const groupMap = new Map(); // To store created groups for parent references

        // Helper to generate expected slug
        const generateSlug = (name) => {
            return name
                .toString()
                .toLowerCase()
                .trim()
                .replace(/[\s\W-]+/g, '-')
                .replace(/^-+|-+$/g, '');
        };

        // First pass: Create all groups without parents
        for (const groupData of predefinedGroups) {
            const expectedSlug = generateSlug(groupData.name);
            let existingGroup = await Group.findOne({ slug: expectedSlug, isPredefined: true });
            if (!existingGroup) {
                existingGroup = await Group.findOne({ name: groupData.name, isPredefined: true });
            }

            if (!existingGroup) {
                const group = new Group({
                    name: groupData.name,
                    slug: expectedSlug,
                    type: groupData.type,
                    parentGroup: null,
                    isPredefined: true,
                    createdBy: systemUserId,
                    updatedBy: systemUserId,
                    isActive: true
                });

                await group.save();
                groupMap.set(groupData.name, group._id);
                createdGroups.push(group);
                console.log(`✅ Created group: ${groupData.name}`);
            } else {
                groupMap.set(groupData.name, existingGroup._id);
                console.log(`ℹ️  Group already exists: ${groupData.name}`);
            }
        }

        // Second pass: Update parent relationships
        for (const groupData of predefinedGroups) {
            if (groupData.parentName) {
                const expectedSlug = generateSlug(groupData.name);
                let group = await Group.findOne({ slug: expectedSlug, isPredefined: true });
                if (!group) {
                    group = await Group.findOne({ name: groupData.name, isPredefined: true });
                }

                const parentId = groupMap.get(groupData.parentName);

                if (group && parentId && !group.parentGroup) {
                    group.parentGroup = parentId;
                    group.updatedBy = systemUserId;
                    await group.save();
                    console.log(`✅ Updated parent for: ${groupData.name} -> ${groupData.parentName}`);
                }
            }
        }

        console.log(`✔️  Groups initialization completed. Created/Found ${createdGroups.length + (predefinedGroups.length - createdGroups.length)} groups.`);
        return { success: true, created: createdGroups.length, total: predefinedGroups.length };
    } catch (error) {
        console.error('❌ Error initializing groups:', error);
        throw error;
    }
};

export default initializeGroups;

