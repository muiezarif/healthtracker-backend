// models/patientHealthRecord.model.js
import mongoose from "mongoose";
const { Schema } = mongoose;

/**
 * PatientHealthRecord
 * Stores category->conditions[] selections, freeform notes, and a timestamp.
 * Aligns to the payload built in PatientHealthRecord.jsx (patientId, recordedAt, categories, notes).
 */
const CategoriesMapSchema = new Schema(
  {
    // we want a Map<string, string[]>
    categories: {
      type: Map,
      of: {
        type: [String],
        default: [],
        set: (arr) =>
          Array.from(
            new Set(
              (arr || [])
                .map((s) => String(s).trim())
                .filter(Boolean)
            )
          ),
      },
      default: () => new Map(),
    },
  },
  { _id: false }
);

const patientHealthRecordSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    recordedAt: { type: Date, default: Date.now },
    notes: { type: String, trim: true, default: null },
    // embed the map of category arrays
    ...CategoriesMapSchema.obj,
  },
  { timestamps: true }
);

// Helpful index for querying a patient's history
patientHealthRecordSchema.index({ patient: 1, recordedAt: -1 });

export default mongoose.model("PatientHealthRecord", patientHealthRecordSchema);
