// models/patientLinkRequest.model.js
import mongoose from "mongoose";
const { Schema } = mongoose;

/**
 * One pending link request from a Patient to a Provider.
 * We delete the request on accept or reject.
 */
const patientLinkRequestSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    provider: { type: Schema.Types.ObjectId, ref: "Provider", required: true },
    message: { type: String, trim: true }, // optional short note from patient
    status: {
      type: String,
      enum: ["pending"],
      default: "pending",
    },
  },
  { timestamps: true }
);

// Prevent multiple *pending* requests for the same (patient, provider)
patientLinkRequestSchema.index(
  { patient: 1, provider: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

export default mongoose.model("PatientLinkRequest", patientLinkRequestSchema);
