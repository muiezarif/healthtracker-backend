import express from 'express';
import {
  getAllPatients,
  getPatientById,
  getSymptomsByPatientId,searchPatients,updatePatient,createPatient,
  getIncomingLinkRequests,
  acceptLinkRequest,
  rejectLinkRequest
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
router.post('/patients', verifyToken, requireProvider, createPatient);
router.get('/patients', verifyToken, requireProvider, getAllPatients);
router.get('/patients/:id', verifyToken, requireProvider, getPatientById);
router.get('/patients/:id/symptoms', verifyToken, requireProvider, getSymptomsByPatientId);
router.get('/patients/search', verifyToken, requireProvider, searchPatients);
router.put('/patients/:id', verifyToken, requireProvider, updatePatient);

// 🔗 Link Requests (provider)
router.get('/link-requests', verifyToken, requireProvider, getIncomingLinkRequests);
router.post('/link-requests/:id/accept', verifyToken, requireProvider, acceptLinkRequest);
router.post('/link-requests/:id/reject', verifyToken, requireProvider, rejectLinkRequest);


export default router;
