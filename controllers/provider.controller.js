import Patient from '../models/patient.model.js';
import Provider from '../models/provider.model.js';
import Symptom from '../models/symptom.model.js';
import bcrypt from 'bcryptjs';

// ✅ Helper: Standard Response
const sendResponse = (res, status, message, result = {}, error = "") => {
  res.status(status).json({
    status,
    message,
    result,
    error
  });
};

// 👨‍⚕️ Create a new patient and attach to provider
export const createPatient = async (req, res) => {
  try {
    const providerId = req.user.id;
    const { name, email, password, age, sex, phone_number, address } = req.body;
    console.log("Creating patient for provider:", providerId);
    console.log("Patient data:", req.body);
    // 🔎 Validate required fields
    if (!name || !email || !password) {
      return sendResponse(res, 400, "Name, email, and password are required", {}, "Missing fields");
    }

    // 📧 Check for duplicate patient email
    const existingPatient = await Patient.findOne({ email });
    if (existingPatient) {
      return sendResponse(res, 409, "Email already exists", {}, "Patient already registered");
    }

    // 🔐 Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 🏥 Create patient with linked provider
    const newPatient = new Patient({
      name,
      email,
      password: hashedPassword,
      age,
      sex,
      phone_number,
      address,
      providers: [providerId]
    });

    await newPatient.save();

    // 🔗 Add patient to provider's patient list
    await Provider.findByIdAndUpdate(providerId, {
      $addToSet: { patients: newPatient._id }
    });

    // ✅ Response
    sendResponse(res, 201, "Patient created and linked to provider successfully", {
      patient: {
        id: newPatient._id,
        name: newPatient.name,
        email: newPatient.email,
        age: newPatient.age,
        sex: newPatient.sex
      }
    });

  } catch (error) {
    console.error("Error creating patient:", error);
    sendResponse(res, 500, "Failed to create patient", {}, error.message);
  }
};

export const getAllPatients = async (req, res) => {
  try {
    const providerId = req.user.id;

    const provider = await Provider.findById(providerId)
      .populate({
        path: 'patients',
        select: '-password'
      });

    if (!provider) {
      return sendResponse(res, 404, "Provider not found", {}, "Invalid provider ID");
    }

    sendResponse(res, 200, "Patients linked to provider fetched successfully", provider.patients);
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

// 🔎 Search patients by name
export const searchPatients = async (req, res) => {
  try {
    const { name } = req.query;

    if (!name || name.trim() === '') {
      return sendResponse(res, 400, "Search query is required", {}, "Name parameter is required");
    }

    // Case-insensitive search using regex
    const patients = await Patient.find({
      name: { $regex: name.trim(), $options: 'i' }
    }).select('-password');

    if (!patients || patients.length === 0) {
      return sendResponse(res, 404, "No patients found matching the search criteria", [], "No matching patients");
    }

    sendResponse(res, 200, `Found ${patients.length} patient(s) matching "${name}"`, patients);
  } catch (error) {
    sendResponse(res, 500, "Failed to search patients", {}, error.message);
  }
};

// ✏️ Update patient details
export const updatePatient = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, age, sex,phone_number,address } = req.body;

    // Check if patient exists
    const existingPatient = await Patient.findById(id);
    if (!existingPatient) {
      return sendResponse(res, 404, "Patient not found", {}, "Patient not found");
    }

    // Check if email is being changed and if it's already taken by another patient
    if (email && email !== existingPatient.email) {
      const emailExists = await Patient.findOne({ 
        email: email, 
        _id: { $ne: id } 
      });
      
      if (emailExists) {
        return sendResponse(res, 400, "Email already exists", {}, "Another patient is already using this email");
      }
    }

    // Prepare update object with only provided fields
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (age !== undefined) updateData.age = age;
    if (sex !== undefined) updateData.sex = sex;
    updateData.phone_number = phone_number;
    updateData.address = address;

    // Validate required fields if provided
    if (name !== undefined && (!name || name.trim() === '')) {
      return sendResponse(res, 400, "Name is required", {}, "Name cannot be empty");
    }
    
    if (email !== undefined && (!email || email.trim() === '')) {
      return sendResponse(res, 400, "Email is required", {}, "Email cannot be empty");
    }
    
    if (age !== undefined && (age === null || age < 0)) {
      return sendResponse(res, 400, "Valid age is required", {}, "Age must be a positive number");
    }

    // Update patient
    const updatedPatient = await Patient.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('providers', 'name email').select('-password');

    sendResponse(res, 200, "Patient details updated successfully", updatedPatient);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return sendResponse(res, 400, "Validation error", {}, validationErrors.join(', '));
    }
    
    if (error.code === 11000) {
      return sendResponse(res, 400, "Email already exists", {}, "This email is already registered");
    }
    
    sendResponse(res, 500, "Failed to update patient details", {}, error.message);
  }
};
