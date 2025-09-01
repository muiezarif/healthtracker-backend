// models/patient.model.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Subschemas */
const HeightSchema = new Schema(
  {
    unit: { type: String, enum: ['cm', 'ftin'], required: true, default: 'cm' },
    // When unit === 'cm'
    cm: { type: Number, min: 0 },
    // When unit === 'ftin'
    ft: { type: Number, min: 0 },
    in: { type: Number, min: 0 },
  },
  { _id: false }
);

const WeightSchema = new Schema(
  {
    unit: { type: String, enum: ['kg', 'lbs'], required: true, default: 'kg' },
    // When unit === 'kg'
    kg: { type: Number, min: 0 },
    // When unit === 'lbs'
    lbs: { type: Number, min: 0 },
  },
  { _id: false }
);

const PhysicalBaselineSchema = new Schema(
  {
    height: { type: HeightSchema, default: () => ({ unit: 'cm', cm: null }) },
    weight: { type: WeightSchema, default: () => ({ unit: 'kg', kg: null }) },
    // Stored but also auto-derived from height/weight if possible
    bmi: { type: Number, min: 0 },
  },
  { _id: false }
);

const AddressSchema = new Schema(
  {
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zip: { type: String, trim: true },
  },
  { _id: false }
);

const EmergencyContactSchema = new Schema(
  {
    name: { type: String, trim: true },
    phone: { type: String, trim: true },
  },
  { _id: false }
);

/** Main Schema */
const patientSchema = new Schema(
  {
    /** Auth / Core */
    fullName: { type: String, required: true, trim: true },
    // legacy support: keep "name" in case other code still reads it
    name: { type: String, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: { type: String, required: true },

    /** Demographics */
    dob: { type: Date }, // frontend sends YYYY-MM-DD; convert to Date before save as needed
    age: { type: Number, min: 0 }, // derived from dob if dob provided
    sexAtBirth: { type: String, enum: ['Male', 'Female', 'Other'], required: true },
    genderIdentity: { type: String, trim: true }, // optional

    address: { type: AddressSchema, default: () => ({}) },

    phone: { type: String, trim: true },
    // Keep legacy "phone_number" if other code references it; mirror from "phone"
    phone_number: { type: String, trim: true },

    /** Physical Baseline */
    physicalBaseline: { type: PhysicalBaselineSchema, default: () => ({}) },

    /** Basic Health Flags */
    allergies: {
      type: [String],
      default: [],
      set: (arr) => Array.from(new Set((arr || []).map((s) => String(s).trim()).filter(Boolean))), // de-dupe/trim
    },
    conditions: {
      type: [String],
      default: [],
      set: (arr) => Array.from(new Set((arr || []).map((s) => String(s).trim()).filter(Boolean))),
    },
    medications: {
      type: [String],
      default: [],
      set: (arr) => Array.from(new Set((arr || []).map((s) => String(s).trim()).filter(Boolean))),
    },

    /** Emergency & Compliance */
    emergencyContact: { type: EmergencyContactSchema, default: () => ({}) },
    primaryCareProvider: { type: String, trim: true },

    // Must be true to save (per UI)
    consent: { type: Boolean, required: true, default: false },

    recordedAt: { type: Date }, // frontend includes this; if absent we can default in pre-save

    /** Associations */
    role: { type: String, default: 'patient' },
    providers: [{ type: Schema.Types.ObjectId, ref: 'Provider' }],
  },
  { timestamps: true }
);

/** Helpers */
function toCm({ unit, cm, ft, in: inches }) {
  if (unit === 'cm') {
    return typeof cm === 'number' ? cm : null;
  }
  if (unit === 'ftin') {
    const ftN = typeof ft === 'number' ? ft : 0;
    const inN = typeof inches === 'number' ? inches : 0;
    const totalIn = ftN * 12 + inN;
    if (totalIn <= 0) return null;
    return totalIn * 2.54;
  }
  return null;
}
function toKg({ unit, kg, lbs }) {
  if (unit === 'kg') return typeof kg === 'number' ? kg : null;
  if (unit === 'lbs') return typeof lbs === 'number' ? lbs * 0.45359237 : null;
  return null;
}
function calcBmi(cm, kg) {
  if (!cm || !kg || cm <= 0 || kg <= 0) return null;
  const m = cm / 100;
  return Number((kg / (m * m)).toFixed(1));
}

/** Pre-save derivations & normalization */
patientSchema.pre('save', function (next) {
  // mirror fullName -> name (legacy)
  if (this.fullName && !this.name) this.name = this.fullName;

  // mirror phone -> phone_number (legacy)
  if (this.phone && !this.phone_number) this.phone_number = this.phone;

  // normalize email casing
  if (this.email) this.email = this.email.toLowerCase().trim();

  // derive age from dob if dob is present
  if (this.dob) {
    const birth = new Date(this.dob);
    if (!isNaN(birth.getTime())) {
      const today = new Date();
      let years = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) years--;
      this.age = years;
    }
  }

  // derive BMI from height+weight if missing or inconsistent
  if (this.physicalBaseline) {
    const { height, weight } = this.physicalBaseline;
    const cm = height ? toCm(height) : null;
    const kg = weight ? toKg(weight) : null;
    const derived = calcBmi(cm, kg);
    if (derived) this.physicalBaseline.bmi = derived;
  }

  // default recordedAt if not set
  if (!this.recordedAt) this.recordedAt = new Date();

  next();
});

/** Indexes */
patientSchema.index({ email: 1 }, { unique: true });
patientSchema.index({ fullName: 'text' });

export default mongoose.model('Patient', patientSchema);
