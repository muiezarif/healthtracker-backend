import express from 'express';
import {
  getAllPatients,
  getPatientById,
  getSymptomsByPatientId
} from '../controllers/provider.controller.js';

import { verifyToken } from '../middlewares/auth.middleware.js';

export const requireProvider = (req, res, next) => {
  if (req.user.role !== 'provider') {
    return res.status(403).json({
      status: 403,
      message: "Access denied",
      result: {},
      error: "Only providers can access this route"
    });
  }
  next();
};


const router = express.Router();

router.get('/patients', verifyToken, requireProvider, getAllPatients);
router.get('/patients/:id', verifyToken, requireProvider, getPatientById);
router.get('/patients/:id/symptoms', verifyToken, requireProvider, getSymptomsByPatientId);

export default router;
