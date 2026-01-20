// Script to update existing trips with rentPerKm = 0
// Run this script once to set existing trips' rent per KM to zero

import mongoose from 'mongoose';
import Trip from '../models/Trip.js';
import { config } from 'dotenv';

// Load environment variables
config();

const updateExistingTripsRent = async () => {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/poultry-record-app');
        console.log('Connected to MongoDB');

        // Update all existing trips to set rentPerKm to 0
        const result = await Trip.updateMany(
            { rentPerKm: { $exists: false } }, // Only update trips that don't have rentPerKm field
            { $set: { rentPerKm: 0 } }
        );

        console.log(`Updated ${result.modifiedCount} trips with rentPerKm = 0`);

        // Also update trips that might have rentPerKm as null or undefined
        const result2 = await Trip.updateMany(
            { 
                $or: [
                    { rentPerKm: null },
                    { rentPerKm: { $exists: false } }
                ]
            },
            { $set: { rentPerKm: 0 } }
        );

        console.log(`Updated ${result2.modifiedCount} additional trips with rentPerKm = 0`);

        console.log('Migration completed successfully!');
        
    } catch (error) {
        console.error('Error updating trips:', error);
    } finally {
        // Close the connection
        await mongoose.connection.close();
        console.log('Database connection closed');
    }
};

// Run the migration
updateExistingTripsRent();
