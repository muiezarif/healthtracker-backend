import Symptom from '../models/symptom.model.js';
import Patient from '../models/patient.model.js';
import Provider from '../models/provider.model.js';
import PatientHealthRecord from "../models/patientHealthRecord.model.js";
import PatientLinkRequest from "../models/patientLinkRequest.model.js";

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

// --- UPDATE: patient profile from PatientProfile.jsx payload ---
export const updateMyProfile = async (req, res) => {
  try {
    const patientId = req.user.id;

    // Find the authenticated patient's document
    const doc = await Patient.findById(patientId);
    if (!doc) return sendResponse(res, 404, "Patient not found");

    // Whitelist of top-level fields we allow updating
    const {
      fullName,
      dob,
      age,
      sexAtBirth,
      genderIdentity,
      address,
      phone,
      email,
      physicalBaseline,
      allergies,
      conditions,
      medications,
      emergencyContact,
      primaryCareProvider,
      consent,
      recordedAt,
    } = req.body || {};

    // Minimal validations aligned with the UI
    if (!fullName || !sexAtBirth) {
      return sendResponse(res, 400, "fullName and sexAtBirth are required");
    }
    if (!dob && (age == null || age === "")) {
      return sendResponse(res, 400, "Provide either dob or age");
    }
    if (consent !== true) {
      return sendResponse(res, 400, "Consent must be accepted to continue");
    }

    // Assign simple fields
    if (fullName != null) doc.fullName = String(fullName).trim();
    if (dob != null) doc.dob = dob ? new Date(dob) : null; // schema will derive age if dob present
    if (age != null && age !== "") doc.age = Number(age);
    if (sexAtBirth != null) doc.sexAtBirth = sexAtBirth;
    if (genderIdentity != null) doc.genderIdentity = genderIdentity?.trim() || null;
    if (phone != null) doc.phone = phone?.trim() || null;
    if (email != null) doc.email = email?.trim() || null;
    if (primaryCareProvider != null) doc.primaryCareProvider = primaryCareProvider?.trim() || null;
    if (consent != null) doc.consent = Boolean(consent);
    if (recordedAt != null) doc.recordedAt = recordedAt ? new Date(recordedAt) : new Date();

    // Merge nested: address
    if (address && typeof address === "object") {
      doc.address = {
        ...(doc.address?.toObject?.() || doc.address || {}),
        city: address.city ?? doc.address?.city ?? null,
        state: address.state ?? doc.address?.state ?? null,
        zip: address.zip ?? doc.address?.zip ?? null,
      };
    }

    // Merge nested: physicalBaseline (height, weight, bmi)
    if (physicalBaseline && typeof physicalBaseline === "object") {
      const prev = doc.physicalBaseline?.toObject?.() || doc.physicalBaseline || {};
      doc.physicalBaseline = {
        ...prev,
        height: physicalBaseline.height ?? prev.height ?? undefined,
        weight: physicalBaseline.weight ?? prev.weight ?? undefined,
        bmi: physicalBaseline.bmi ?? prev.bmi ?? undefined,
      };
    }

    // Arrays (schema setters will trim + de-dupe)
    if (Array.isArray(allergies)) doc.allergies = allergies;
    if (Array.isArray(conditions)) doc.conditions = conditions;
    if (Array.isArray(medications)) doc.medications = medications;

    // Save to run schema hooks (age derivation, BMI calc, mirrors)
    await doc.save();

    // Hide sensitive fields like password in the response
    const safe = doc.toObject();
    delete safe.password;

    return sendResponse(res, 200, "Profile updated", safe);
  } catch (error) {
    return sendResponse(res, 500, "Failed to update profile", {}, error.message);
  }
};

// ➕ Create OR Update a single health record for the patient (idempotent POST)
export const createHealthRecord = async (req, res) => {
  try {
    const ownerId = req.user?.id || req.body?.patientId;
    if (!ownerId) {
      return sendResponse(res, 400, "Missing authenticated patient id", {}, "No patient id");
    }

    const { recordedAt, categories, notes } = req.body || {};

    // Normalize categories → Map<string, string[]>
    const map = new Map();
    if (categories && typeof categories === "object") {
      for (const [cat, list] of Object.entries(categories)) {
        const cleaned = Array.from(
          new Set((Array.isArray(list) ? list : [])
            .map((s) => String(s).trim())
            .filter(Boolean))
        );
        if (cleaned.length) map.set(String(cat), cleaned);
      }
    }

    // Find existing record (one per patient) or create on first call
    let doc = await PatientHealthRecord.findOne({ patient: ownerId });
    const isCreate = !doc;

    if (!doc) {
      doc = new PatientHealthRecord({
        patient: ownerId,
        recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
        categories: map,
        notes: notes?.trim() || null,
      });
    } else {
      if (recordedAt != null) doc.recordedAt = recordedAt ? new Date(recordedAt) : new Date();
      if (categories != null) doc.categories = map;             // replace only if supplied
      if (notes !== undefined) doc.notes = notes?.trim() || null;
    }

    await doc.save();
    return sendResponse(res, isCreate ? 201 : 200, "Health record saved", doc);
  } catch (error) {
    return sendResponse(res, 500, "Failed to save health record", {}, error.message);
  }
};

// 📄 Get history of health records for the logged-in patient
export const getHealthRecordHistory = async (req, res) => {
  try {
    const patientId = req.user?.id;
    if (!patientId) {
      return sendResponse(res, 401, "Unauthorized");
    }

    const records = await PatientHealthRecord
      .find({ patient: patientId })
      .sort({ recordedAt: -1, createdAt: -1 });

    return sendResponse(res, 200, "Health record history fetched", records);
  } catch (error) {
    return sendResponse(res, 500, "Failed to fetch health record history", {}, error.message);
  }
};


// Get all providers
export const getProviders = async (req, res) => {
  try {
    const providers = await Provider.find().select('-password'); // Exclude password
    sendResponse(res,200,"Fetched providers",providers,{});
  } catch (error) {
    sendResponse( res,500, 'Error fetching providers',{}, error.message);
  }
};

// Patient -> send a link request to a provider
export const requestLinkToProvider = async (req, res) => {
  try {
    const patientId = req.user.id; // requireToken+requirePatient guards this
    const { providerId, message } = req.body || {};
    if (!providerId) {
      return sendResponse(res, 400, "providerId is required");
    }

    // Ensure provider exists
    const providerExists = await Provider.exists({ _id: providerId });
    if (!providerExists) {
      return sendResponse(res, 404, "Provider not found");
    }

    // If already linked, short-circuit
    const alreadyLinked = await Patient.exists({
      _id: patientId,
      providers: providerId,
    });
    if (alreadyLinked) {
      return sendResponse(res, 200, "Already linked to this provider", { alreadyLinked: true });
    }

    // If a pending request exists, return it (idempotent)
    const existing = await PatientLinkRequest.findOne({
      patient: patientId,
      provider: providerId,
      status: "pending",
    });
    if (existing) {
      return sendResponse(res, 200, "Request already pending", existing);
    }

    // Create pending request
    const doc = new PatientLinkRequest({
      patient: patientId,
      provider: providerId,
      message: message?.trim() || undefined,
    });
    await doc.save();

    return sendResponse(res, 201, "Link request created", doc);
  } catch (error) {
    // Duplicate pending (rare race) will hit unique index
    if (error?.code === 11000) {
      const doc = await PatientLinkRequest.findOne({
        patient: req.user.id,
        provider: req.body?.providerId,
        status: "pending",
      });
      return sendResponse(res, 200, "Request already pending", doc);
    }
    return sendResponse(res, 500, "Failed to create link request", {}, error.message);
  }
};

// Patient -> view my pending link requests
export const getMyLinkRequests = async (req, res) => {
  try {
    const patientId = req.user.id;
    const requests = await PatientLinkRequest.find({
      patient: patientId,
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .populate("provider", "name email");
    return sendResponse(res, 200, "Pending link requests fetched", requests);
  } catch (error) {
    return sendResponse(res, 500, "Failed to fetch link requests", {}, error.message);
  }
};






