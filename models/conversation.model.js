// models/conversation.model.js
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["patient", "assistant"], required: true },
    text: { type: String, required: true }
    // removed `at`
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true
    },
    messages: { type: [messageSchema], default: [] }
  },
  { timestamps: true } // keeps createdAt/updatedAt automatically if you still want them
);

export default mongoose.model("Conversation", conversationSchema);
