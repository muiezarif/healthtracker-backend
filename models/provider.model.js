import mongoose from 'mongoose';

const providerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  age: { type: Number },
  sex: { type: String },
  phone_number: { type: String },
  role: { type: String, default: 'provider' },
  patients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Patient' }],
  address: { type: String },

}, { timestamps: true });

export default mongoose.model('Provider', providerSchema);
