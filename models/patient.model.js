import mongoose from 'mongoose';

const patientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'patient' },
  providers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Provider' }]
}, { timestamps: true });

export default mongoose.model('Patient', patientSchema);
