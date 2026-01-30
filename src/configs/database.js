import mongoose from 'mongoose';
import { config } from 'dotenv';

config({ path: `${process.cwd()}/src/.env` });

const connectDB = async () =>
  await mongoose.connect(`${process.env.DATABASE_URI}/${process.env.DATABASE_NAME}`, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

export default connectDB;