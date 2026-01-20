import { config } from 'dotenv';
config({ path: `${process.cwd()}/src/.env` });
import jwt from 'jsonwebtoken';
import AppError from '../utils/AppError.js';

const authenticateToken = async(req, res, next) => {
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1];
  const cookieToken = req.cookies?.token || req.cookies?.accessToken;
  const token = headerToken || cookieToken;
  
  try {

    if (!token) throw new AppError('Unauthorized user!!', 401);

    const decodeData = await jwt.verify(token, process.env.JWT_SECRET)

    if (!decodeData) throw new AppError('Unauthorized user!!', 401);

    req.user = decodeData._doc;

    next();

  } catch (error) {
    console.error(error.message)
    throw new AppError('Unauthorized user!!', 401);
  }

};

export default authenticateToken;