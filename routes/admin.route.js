import express from 'express';
import {
  getAllProviders,
  getProviderById,
  getAllPatients,
  getPatientById
} from '../controllers/admin.controller.js';

import { verifyToken } from '../middlewares/auth.middleware.js';

export const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Admins only.' });
  }
  next();
};


const router = express.Router();

// Add verifyToken middleware to protect admin routes
router.get('/providers', verifyToken,requireAdmin, getAllProviders);
router.get('/providers/:id', verifyToken,requireAdmin, getProviderById);

router.get('/patients', verifyToken,requireAdmin, getAllPatients);
router.get('/patients/:id', verifyToken,requireAdmin, getPatientById);

export default router;
