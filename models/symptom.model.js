import mongoose from 'mongoose';

const symptomSchema = new mongoose.Schema({
  symptom_type: { type: String, required: true },
  symptom: { type: String },
  description: { type: String },
  severity_level: { 
    type: Number, 
    required: true,
    min: 1,
    max: 10
  },
  additional_notes: { type: String },
  patient: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Patient', 
    required: true 
  }
}, { timestamps: true });

export default mongoose.model('Symptom', symptomSchema);
