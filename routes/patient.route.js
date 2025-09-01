import express from 'express';
import {
    addSymptom,
    getSymptomHistory,
    addProvider,
    updateSymptom,
    deleteSymptom,
    updateMyProfile,
    createHealthRecord,
    getHealthRecordHistory,
    getProviders,
    requestLinkToProvider,
    getMyLinkRequests
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
router.get('/providers', verifyToken, getProviders);
router.put('/symptoms/:id', verifyToken, updateSymptom);
router.delete('/symptoms/:id', verifyToken, deleteSymptom);
router.put('/profile', verifyToken, requirePatient, updateMyProfile);
router.post("/health-records", verifyToken, createHealthRecord);
router.get("/health-records/history", verifyToken, getHealthRecordHistory);

// 🔗 Link Requests (patient)
router.post('/link-requests', verifyToken, requirePatient, requestLinkToProvider);
router.get('/link-requests', verifyToken, requirePatient, getMyLinkRequests);
export default router;
