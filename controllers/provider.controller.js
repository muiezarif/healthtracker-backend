import Patient from '../models/patient.model.js';
import Symptom from '../models/symptom.model.js';

// ✅ Helper: Standard Response
const sendResponse = (res, status, message, result = {}, error = "") => {
  res.status(status).json({
    status,
    message,
    result,
    error
  });
};

// 📄 Get all patients
export const getAllPatients = async (req, res) => {
  try {
    const patients = await Patient.find().select('-password');
    sendResponse(res, 200, "All patients fetched successfully", patients);
  } catch (error) {
    sendResponse(res, 500, "Failed to fetch patients", {}, error.message);
  }
};

// 🔍 Get patient detail by ID
export const getPatientById = async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id)
      .populate('providers', 'name email')
      .select('-password');

    if (!patient) {
      return sendResponse(res, 404, "Patient not found", {}, "Patient not found");
    }

    sendResponse(res, 200, "Patient details fetched successfully", patient);
  } catch (error) {
    sendResponse(res, 500, "Failed to fetch patient details", {}, error.message);
  }
};

// 📝 Get symptoms of a patient
export const getSymptomsByPatientId = async (req, res) => {
  try {
    const symptoms = await Symptom.find({ patient: req.params.id });

    if (!symptoms || symptoms.length === 0) {
      return sendResponse(res, 404, "No symptoms found for this patient", {}, "No symptoms available");
    }

    sendResponse(res, 200, "Symptoms fetched successfully", symptoms);
  } catch (error) {
    sendResponse(res, 500, "Failed to fetch symptoms", {}, error.message);
  }
};
