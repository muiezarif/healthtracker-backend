// routes/conversation.route.js
import express from "express";
import Conversation from "../models/conversation.model.js";
import { verifyToken } from "../middlewares/auth.middleware.js";

const router = express.Router();


router.post("/",verifyToken, async (req, res) => {
  try {
    const patientId = req.user.id; // from auth middleware
    const { messages, reason } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "No messages provided" });
    }

    const convo = new Conversation({
      patient: patientId,
      messages,   // already [{role,text}]
    });

    await convo.save();
    res.status(201).json({ success: true, conversation: convo });
  } catch (err) {
    console.error("Save conversation failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations (latest first)
router.get("/",verifyToken, async (req, res) => {
  try {
    const patientId = req.user?.id;
    if (!patientId) return res.status(401).json({ error: "Unauthorized" });

    const convos = await Conversation.find({ patient: patientId })
      .sort({ createdAt: -1 });
    res.json({ conversations: convos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
