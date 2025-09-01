import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Patient from '../models/patient.model.js';
import Provider from '../models/provider.model.js';
import Admin from '../models/admin.model.js';

// ✅ Standard Response Helper
const sendResponse = (res, status, message, result = {}, error = "") => {
  return res.status(status).json({ status, message, result, error });
};

// 🔍 Role-based model getter
const getModelByRole = (role) => {
  if (role === 'patient') return Patient;
  if (role === 'provider') return Provider;
  if (role === 'admin') return Admin;
  throw new Error('Invalid role');
};

// ✅ Register Controller
export const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return sendResponse(res, 400, "All fields are required", {}, "Missing required fields");
    }

    const Model = getModelByRole(role);
    const existingUser = await Model.findOne({ email });

    if (existingUser) {
      return sendResponse(res, 409, "Email already exists", {}, "User already registered");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new Model({ name, email, password: hashedPassword });
    await user.save();

    return sendResponse(res, 201, `${role} registered successfully`, {
      id: user._id,
      email: user.email,
      role: user.role
    });
  } catch (error) {
    return sendResponse(res, 500, "Registration failed", {}, error.message);
  }
};

// ✅ Login Controller
export const login = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return sendResponse(res, 400, "Email, password, and role are required", {}, "Missing login credentials");
    }

    const Model = getModelByRole(role);
    const user = await Model.findOne({ email });

    if (!user) {
      return sendResponse(res, 404, "User not found", {}, "Invalid user credentials");
    }

    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      return sendResponse(res, 401, "Invalid credentials", {}, "Incorrect password");
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    return sendResponse(res, 200, "Login successful", {
      token,
      user
    });
  } catch (error) {
    return sendResponse(res, 500, "Login failed", {}, error.message);
  }
};
