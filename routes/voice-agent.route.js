import express from 'express';
import dotenv from "dotenv"
import mongoose from "mongoose";

import Conversation from "../models/conversation.model.js";
import Symptom from "../models/symptom.model.js";
dotenv.config();
const router = express.Router();


// Realtime session token — conversational instructions, no “type” question.
// The assistant will infer the category from the symptom/description.
router.get("/symptom-recorder/token", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        modalities: ["text", "audio"],
        voice: "alloy",
        instructions: `You are a friendly clinical intake assistant. Keep it conversational and empathetic.
Gather the patient's symptom information in a natural flow. DO NOT ask the patient to classify their symptom as physical, emotional, or mental.
Instead, infer that category yourself from what they say.

Flow:
- Greet briefly and ask what symptom they're experiencing and tell the patient that they can record physical,emotional or mental symptoms.
- Ask for severity of symptoms if multiple then ask each symptom rating separately (Mild,Moderate,severe,worst).
- Ask for a short description in their own words (what it feels like, onset, timing).
- Ask if there are any extra notes (triggers, context, anything else they'd like to add).
- Confirm you’ve captured the details.
- Also recall which symptoms were recorded in previous sessions and avoid asking about those again.

Style:
- Short, clear questions. One at a time. Wait for the patient's response before continuing.
- Be supportive and non-alarming.
- Don't provide medical diagnosis or treatment recommendations.`,

        input_audio_transcription: { model: "whisper-1" },
        // Tuned to reduce turn spam (optional; adjust to taste)
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 500,
          silence_duration_ms: 500
        },
        temperature: 0.7,
        max_response_output_tokens: 256
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", errorText);
      return res.status(response.status).json({
        error: "Failed to create session",
        details: errorText
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});


router.get("/provider-report/token", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        modalities: ["text", "audio"],
        voice: "alloy",
        // The assistant is told to rely on PATIENT_CONTEXT the client will send first.
        instructions: `You are a clinical report assistant for healthcare providers.
You ONLY answer using the PATIENT_CONTEXT JSON the client will send in the FIRST user message.
That JSON includes (1) structured symptom data and (2) snippets of prior patient-assistant conversations.
Guidelines:
- Be concise and clinically useful. Use plain language first, then bullets.
- Time-window questions (e.g. "past week") must use the window in the question; otherwise default to the context's windowDays.
- If the requested answer is outside the PATIENT_CONTEXT, say what is missing and ask the provider to refresh the report or adjust the time range.
- Never invent data. Never provide diagnoses or treatment.

Output style:
- Direct answer (1–2 sentences), then bullets for: key symptoms, trends, and any notable quotes from conversations (if relevant).
- Include dates when summarizing trends.`,

        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 500,
          silence_duration_ms: 500
        },
        temperature: 0.7,
        max_response_output_tokens: 350
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", errorText);
      return res.status(response.status).json({ error: "Failed to create session", details: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

/** ---------------- Provider: patient data payload for the report ----------------
 * Returns symptoms + conversation snippets for a patient within a time window.
 * Frontend will pass this JSON as the first user message (PATIENT_CONTEXT).
 */
router.get("/provider-report/patient-data", async (req, res) => {
  try {
    const { patientId, windowDays = 7 } = req.query;
    if (!patientId || !mongoose.Types.ObjectId.isValid(patientId)) {
      return res.status(400).json({ error: "patientId is required" });
    }

    const days = Math.max(1, Math.min(90, Number(windowDays) || 7));
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    // Symptoms in the window
    const symptoms = await Symptom.find({
      patient: patientId,
      createdAt: { $gte: start, $lte: end },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Quick aggregates
    const byType = { physical: [], mental: [], emotional: [], other: [] };
    let total = 0, sumSeverity = 0;
    for (const s of symptoms) {
      const t = ["physical", "mental", "emotional"].includes(s.symptom_type) ? s.symptom_type : "other";
      byType[t].push(s);
      total += 1;
      if (typeof s.severity_level === "number") sumSeverity += s.severity_level;
    }
    const avgSeverity = total ? +(sumSeverity / total).toFixed(2) : null;

    // Timeline (daily)
    const timelineMap = new Map();
    for (const s of symptoms) {
      const key = new Date(s.createdAt).toISOString().slice(0, 10);
      const e = timelineMap.get(key) || { date: key, count: 0, sum: 0 };
      e.count += 1;
      e.sum += (s.severity_level || 0);
      timelineMap.set(key, e);
    }
    const timeline = Array.from(timelineMap.values())
      .map(({ date, count, sum }) => ({ date, count, avgSeverity: +(sum / count).toFixed(2) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Conversations in the window (last 10 threads)
    const convs = await Conversation.find({
      patient: patientId,
      updatedAt: { $gte: start, $lte: end },
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean();

    // Flatten last ~100 messages for context (no per-message timestamps in schema)
    const flatMessages = [];
    for (const c of convs) {
      if (Array.isArray(c.messages)) {
        for (const m of c.messages) {
          if (m?.role && m?.text) {
            flatMessages.push({ role: m.role, text: m.text });
          }
        }
      }
      if (flatMessages.length > 100) break;
    }
    const recentConversation = flatMessages.slice(-100);

    res.json({
      patientId,
      windowDays: days,
      range: { startISO: start.toISOString(), endISO: end.toISOString() },
      symptoms: {
        total,
        avgSeverity,
        countsByType: {
          physical: byType.physical.length,
          mental: byType.mental.length,
          emotional: byType.emotional.length,
          other: byType.other.length,
        },
        recent: symptoms.slice(0, 20).map(s => ({
          id: String(s._id),
          type: s.symptom_type,
          symptom: s.symptom,
          description: s.description,
          severity: s.severity_level,
          notes: s.additional_notes,
          createdAt: s.createdAt,
        })),
        timeline
      },
      conversations: {
        threads: convs.length,
        recentMessages: recentConversation
      }
    });
  } catch (error) {
    console.error("provider-report/patient-data error", error);
    res.status(500).json({ error: "Failed to fetch patient report data", details: error.message });
  }
});

export default router;
