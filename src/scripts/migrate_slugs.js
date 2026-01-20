import mongoose from 'mongoose';
import connectDB from '../configs/database.js';
import Group from '../models/Group.js';
import Ledger from '../models/Ledger.js';
import { config } from 'dotenv';
import path from 'path';

// Ensure env is loaded (redundant if connectDB does it, but safe)
config({ path: path.join(process.cwd(), 'src', '.env') });

const migrateSlugs = async () => {
    try {
        await connectDB();
        console.log('Connected to Database');

        // Migrate Groups
        const groups = await Group.find({ slug: { $exists: false } });
        console.log(`Found ${groups.length} groups without slug.`);

        for (const group of groups) {
            // Saving triggers the pre-save hook which generates the slug
            await group.save();
            console.log(`Updated group: ${group.name} -> ${group.slug}`);
        }

        // Migrate Ledgers
        const ledgers = await Ledger.find({ slug: { $exists: false } });
        console.log(`Found ${ledgers.length} ledgers without slug.`);

        for (const ledger of ledgers) {
            await ledger.save();
            console.log(`Updated ledger: ${ledger.name} -> ${ledger.slug}`);
        }

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrateSlugs();
