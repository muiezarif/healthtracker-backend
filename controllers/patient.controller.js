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
    const { symptom_type,symptom, description, severity_level, additional_notes } = req.body;
    const patientId = req.user.id;

    if (!symptom_type || !severity_level) {
      return sendResponse(res, 400, "Symptom type and severity level are required", {}, "Missing required fields");
    }

    const symptomMod = new Symptom({
      symptom_type,
      description,
      severity_level,
      additional_notes,
      patient: patientId
    });

    await symptomMod.save();
    sendResponse(res, 201, "Symptom added successfully", symptomMod);
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

// simple categorizer (mirrors index.js)
const inferType = (textRaw = '') => {
  const text = String(textRaw).toLowerCase();
  const physical = ['pain','ache','fever','cough','nausea','vomit','dizziness','rash','injury','cramp','chest','breath','headache','throat','stomach','diarrhea','fatigue','swelling','back','arm','leg','ear','nose','flu','cold'];
  const mental   = ['focus','memory','concentrat','insomnia','sleep','adhd','brain fog','confus','hallucin','delusion','cognitive'];
  const emotional= ['anxiety','anxious','depress','sad','mood','anger','irritab','stress','panic','fear','lonely'];
  const hit = (arr) => arr.some(k => text.includes(k));
  if (hit(emotional)) return 'emotional';
  if (hit(mental)) return 'mental';
  if (hit(physical)) return 'physical';
  return 'physical';
};

const toSeverity = (v) => {
  if (v == null) return null;
  if (typeof v === 'number' && !Number.isNaN(v)) return Math.min(10, Math.max(1, v));
  const s = String(v);
  const m = s.match(/\b(10|[1-9])\b/);
  const n = m ? Number(m[1]) : Number(s);
  if (Number.isFinite(n)) return Math.min(10, Math.max(1, n));
  return null;
};

// ➕ Add (link) a provider to patient
export const addProvider = async (req, res) => {
  try {
    const patientId = req.user.id;

    // Accept both FE-friendly keys and API keys
    const {
      symptom_type,              // API/voice
      symptom,                   // API/voice
      description,               // API/voice
      severity_level,            // API/voice
      additional_notes,          // API/voice
      type,                      // FE alias
      severity,                  // FE alias
      notes,                     // FE alias
      symptom_name,              // any legacy alias
      details                    // any legacy alias
    } = req.body;

    const finalSeverity = toSeverity(severity_level ?? severity);
    const shortName = symptom ?? symptom_name ?? '';
    const desc = description ?? details ?? '';
    const notesFinal = additional_notes ?? notes ?? '';

    const finalType =
      symptom_type ??
      type ??
      inferType([shortName, desc, notesFinal].filter(Boolean).join(' '));

    if (!finalType || !finalSeverity) {
      return sendResponse(res, 400, "Symptom type and severity level are required", {}, "Missing required fields");
    }

    const doc = new Symptom({
      symptom_type: finalType,
      symptom: shortName,
      description: desc,
      severity_level: finalSeverity,
      additional_notes: notesFinal,
      patient: patientId
    });

    await doc.save();
    return sendResponse(res, 201, "Symptom added successfully", doc);
  } catch (error) {
    return sendResponse(res, 500, "Failed to add symptom", {}, error.message);
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


