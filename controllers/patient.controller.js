import Symptom from '../models/symptom.model.js';
import Patient from '../models/patient.model.js';
import Provider from '../models/provider.model.js';

// ✅ Helper: Standard Response
const sendResponse = (res, status, message, result = {}, error = "") => {
  res.status(status).json({ status, message, result, error });
};

// ➕ Add a new symptom
export const addSymptom = async (req, res) => {
    console.log("Adding symptom for patient:", req.body);
  try {
    const { symptom_type, description, severity_level, additional_notes } = req.body;
    const patientId = req.user.id;

    if (!symptom_type || !severity_level) {
      return sendResponse(res, 400, "Symptom type and severity level are required", {}, "Missing required fields");
    }

    const symptom = new Symptom({
      symptom_type,
      description,
      severity_level,
      additional_notes,
      patient: patientId
    });

    await symptom.save();
    sendResponse(res, 201, "Symptom added successfully", symptom);
  } catch (error) {
    sendResponse(res, 500, "Failed to add symptom", {}, error.message);
  }
};

// 📄 Get symptom history of logged-in patient
export const getSymptomHistory = async (req, res) => {
  try {
    const patientId = req.user.id;
    const symptoms = await Symptom.find({ patient: patientId }).sort({ createdAt: -1 });

    sendResponse(res, 200, "Symptom history fetched", symptoms);
  } catch (error) {
    sendResponse(res, 500, "Failed to fetch symptom history", {}, error.message);
  }
};

// ➕ Add (link) a provider to patient
export const addProvider = async (req, res) => {
  try {
    const { providerId } = req.body;
    const patientId = req.user.id;

    const provider = await Provider.findById(providerId);
    if (!provider) {
      return sendResponse(res, 404, "Provider not found", {}, "Invalid provider ID");
    }

    const patient = await Patient.findById(patientId);
    if (!patient) {
      return sendResponse(res, 404, "Patient not found", {}, "Invalid patient ID");
    }

    if (patient.providers.includes(providerId)) {
      return sendResponse(res, 400, "Provider already added", {}, "Provider is already linked");
    }

    patient.providers.push(providerId);
    await patient.save();

    sendResponse(res, 200, "Provider linked successfully", patient.providers);
  } catch (error) {
    sendResponse(res, 500, "Failed to link provider", {}, error.message);
  }
};

// ✏️ Update symptom (only by owner)
export const updateSymptom = async (req, res) => {
  try {
    const { id } = req.params;
    const patientId = req.user.id;

    const symptom = await Symptom.findById(id);

    if (!symptom) {
      return sendResponse(res, 404, "Symptom not found", {}, "Invalid symptom ID");
    }

    if (symptom.patient.toString() !== patientId) {
      return sendResponse(res, 403, "Unauthorized to update this symptom", {}, "Permission denied");
    }

    const updatedData = req.body;
    const updatedSymptom = await Symptom.findByIdAndUpdate(id, updatedData, { new: true });

    sendResponse(res, 200, "Symptom updated successfully", updatedSymptom);
  } catch (error) {
    sendResponse(res, 500, "Failed to update symptom", {}, error.message);
  }
};

// ❌ Delete symptom (only by owner)
export const deleteSymptom = async (req, res) => {
  try {
    const { id } = req.params;
    const patientId = req.user.id;

    const symptom = await Symptom.findById(id);

    if (!symptom) {
      return sendResponse(res, 404, "Symptom not found", {}, "Invalid symptom ID");
    }

    if (symptom.patient.toString() !== patientId) {
      return sendResponse(res, 403, "Unauthorized to delete this symptom", {}, "Permission denied");
    }

    await Symptom.findByIdAndDelete(id);
    sendResponse(res, 200, "Symptom deleted successfully", {});
  } catch (error) {
    sendResponse(res, 500, "Failed to delete symptom", {}, error.message);
  }
};


