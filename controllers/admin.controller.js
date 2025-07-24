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