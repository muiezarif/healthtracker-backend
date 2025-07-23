import express from 'express';
import {
    addSymptom,
    getSymptomHistory,
    addProvider,
    updateSymptom,
    deleteSymptom
} from '../controllers/patient.controller.js';

import { verifyToken } from '../middlewares/auth.middleware.js';
export const requirePatient = (req, res, next) => {
  if (req.user.role !== 'patient') {
    return res.status(403).json({ message: 'Access denied. Admins only.' });
  }
  next();
};
const router = express.Router();

router.post('/symptoms', verifyToken, addSymptom);
router.get('/symptoms/history', verifyToken, getSymptomHistory);
router.post('/providers', verifyToken, addProvider);
router.put('/symptoms/:id', verifyToken, updateSymptom);
router.delete('/symptoms/:id', verifyToken, deleteSymptom);


export default router;
