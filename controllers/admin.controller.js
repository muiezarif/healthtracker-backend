import Provider from '../models/provider.model.js';
import Patient from '../models/patient.model.js';

// ✅ Helper: Standard Response
const sendResponse = (res, status, message, result = {}, error = "") => {
  res.status(status).json({ status, message, result, error });
};

// Get all providers
export const getAllProviders = async (req, res) => {
  try {
    const providers = await Provider.find().select('-password'); // Exclude password
    res.status(200).json(providers);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching providers', error: error.message });
  }
};

// Get provider by ID
export const getProviderById = async (req, res) => {
  try {
    const provider = await Provider.findById(req.params.id).select('-password');
    if (!provider) {
      return res.status(404).json({ message: 'Provider not found' });
    }
    res.status(200).json(provider);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching provider', error: error.message });
  }
};

// Get all patients
export const getAllPatients = async (req, res) => {
  try {
    const patients = await Patient.find().select('-password');
    res.status(200).json(patients);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching patients', error: error.message });
  }
};

// Get patient by ID
export const getPatientById = async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id)
      .populate('providers', 'name email') // show only name & email of providers
      .select('-password');

    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    res.status(200).json(patient);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching patient', error: error.message });
  }
};


// Assign patient to provider
export const assignPatientToProvider = async (req, res) => {
  try {
    const { patientId, providerId } = req.body;

    // Validate input
    if (!patientId || !providerId) {
      return sendResponse(res, 400, 'Both patientId and providerId are required');
    }

    // Check if patient exists
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return sendResponse(res, 404, 'Patient not found');
    }

    // Check if provider exists
    const provider = await Provider.findById(providerId);
    if (!provider) {
      return sendResponse(res, 404, 'Provider not found');
    }

    // Check if provider is already assigned to this patient
    if (patient.providers.includes(providerId)) {
      return sendResponse(res, 400, 'Provider is already assigned to this patient');
    }

    // Check if patient is already in provider's list
    if (provider.patients.includes(patientId)) {
      return sendResponse(res, 400, 'Patient is already assigned to this provider');
    }

    // Add provider to patient's providers array
    patient.providers.push(providerId);
    await patient.save();

    // Add patient to provider's patients array
    provider.patients.push(patientId);
    await provider.save();

    // Return updated patient with populated providers
    const updatedPatient = await Patient.findById(patientId)
      .populate('providers', 'name email')
      .select('-password');

    sendResponse(res, 200, 'Patient successfully assigned to provider', { patient: updatedPatient });

  } catch (error) {
    sendResponse(res, 500, 'Error assigning patient to provider', {}, error.message);
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

// ✏️ Update provider details
export const updateProvider = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, age, sex, phone_number, address } = req.body;

    // Check if provider exists
    const existingProvider = await Provider.findById(id);
    if (!existingProvider) {
      return sendResponse(res, 404, "Provider not found", {}, "Provider not found");
    }

    // Check if email is being changed and if it's already taken by another provider
    if (email && email !== existingProvider.email) {
      const emailExists = await Provider.findOne({ 
        email: email, 
        _id: { $ne: id } 
      });
      
      if (emailExists) {
        return sendResponse(res, 400, "Email already exists", {}, "Another provider is already using this email");
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

    // Update provider
    const updatedProvider = await Provider.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('patients', 'name email').select('-password');

    sendResponse(res, 200, "Provider details updated successfully", updatedProvider);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return sendResponse(res, 400, "Validation error", {}, validationErrors.join(', '));
    }
    
    if (error.code === 11000) {
      return sendResponse(res, 400, "Email already exists", {}, "This email is already registered");
    }
    
    sendResponse(res, 500, "Failed to update provider details", {}, error.message);
  }
};