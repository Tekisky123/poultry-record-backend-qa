import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });
import Trip from './src/models/Trip.js';

async function test() {
  await mongoose.connect(process.env.DATABASE_URI, { dbName: process.env.DATABASE_NAME });
  const trips = await Trip.find({ 'expenses.0': { $exists: true } });
  console.log(`Found ${trips.length} trips with expenses`);
  
  let totalExpenses = 0;
  trips.forEach(t => {
      t.expenses.forEach(e => {
         totalExpenses++;
      });
  });
  console.log('Total expense entries:', totalExpenses);
  if (trips.length > 0) {
      console.log('Sample expense:', trips[0].expenses[0]);
  }
  await mongoose.disconnect();
}
test().catch(console.error);
