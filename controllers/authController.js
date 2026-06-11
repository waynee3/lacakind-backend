import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { createError } from '../middleware/errorHandler.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';


function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email },
    JWT_SECRET,
    { expiresIn: '2d' },
  );
}

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return next(createError(400, 'Email and password are required'));

    const existing = await User.findOne({ email });
    if (existing) return next(createError(409, 'Email already registered'));

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed });

    res.status(201).json({ message: 'User created', email: user.email });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return next(createError(400, 'Email and password are required'));

    const user = await User.findOne({ email });
    if (!user) return next(createError(401, 'Invalid credentials'));

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return next(createError(401, 'Invalid credentials'));

    res.json({ token: signToken(user), email: user.email });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/refresh
const refresh = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next(createError(401, 'No token'));

    const old = jwt.verify(header.split(' ')[1], JWT_SECRET);
    const token = jwt.sign(
      { id: old.id, email: old.email },
      JWT_SECRET,
      { expiresIn: '2d' },
    );
    res.json({ token });
  } catch {
    next(createError(401, 'Invalid or expired token'));
  }
};

export { register, login, refresh };