import mongoose from 'mongoose';

const providerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'provider' }
}, { timestamps: true });

export default mongoose.model('Provider', providerSchema);
