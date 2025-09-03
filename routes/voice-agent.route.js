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

    // const { patientId } = req.params;
    // if (!patientId || !mongoose.Types.ObjectId.isValid(patientId)) {
    //   return res.status(400).json({ error: "patientId is required" });
    // }

     const rawId = String((req.query?.patientId ?? "")).trim();
 if (!rawId) {
   return res.status(400).json({ error: "patientId query param is required" });
 }
 let pid;
 try {
   // build a real ObjectId or throw a clean 422 explaining what’s wrong
   pid = new mongoose.Types.ObjectId(rawId);
 } catch {
   return res.status(422).json({ error: "Invalid patientId format (expected 24-char Mongo ObjectId)" });
 }

    // ---------- Build FULL patient context (all history) ----------
    // Symptoms (all rows)
    const symptoms = await Symptom.find({ patient: pid })
      .sort({ createdAt: 1 }) // oldest -> newest for better trend math
      .lean();

    // Aggregate by type + per-day timeline
    const byType = { physical: 0, mental: 0, emotional: 0, other: 0 };
    let total = 0, sumSeverity = 0;
    const timelineMap = new Map();

    for (const s of symptoms) {
      const t = ["physical", "mental", "emotional"].includes(s.symptom_type) ? s.symptom_type : "other";
      byType[t] += 1;
      total += 1;
      if (typeof s.severity_level === "number") sumSeverity += s.severity_level;
      const day = new Date(s.createdAt).toISOString().slice(0, 10);
      const e = timelineMap.get(day) || { date: day, count: 0, sum: 0 };
      e.count += 1;
      e.sum += (s.severity_level || 0);
      timelineMap.set(day, e);
    }
    const avgSeverity = total ? +(sumSeverity / total).toFixed(2) : null;
    const timeline = Array.from(timelineMap.values())
      .map(({ date, count, sum }) => ({ date, count, avgSeverity: +(sum / count).toFixed(2) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Conversations (all threads) — flatten messages (cap to keep payload sane)
    const convs = await Conversation.find({ patient: pid })
      .sort({ updatedAt: -1 })
      .lean();

    const flatMessages = [];
    for (const c of convs) {
      if (Array.isArray(c.messages)) {
        for (const m of c.messages) {
          if (m?.role && m?.text) flatMessages.push({ role: m.role, text: m.text });
        }
      }
      if (flatMessages.length > 1200) break; // hard cap to avoid giant payloads
    }

    // A compact “recent” slice plus aggregates + timeline gives the model range queries
    const recentSymptoms = symptoms.slice(-100).map(s => ({
      id: String(s._id),
      type: s.symptom_type,
      symptom: s.symptom,
      description: s.description,
      severity: s.severity_level,
      notes: s.additional_notes,
      createdAt: s.createdAt,
    }));

    let PATIENT_CONTEXT = {
      patientId: String(pid),
      summary: {
        totalSymptoms: total,
        avgSeverity,
        countsByType: byType,
        firstRecordDate: symptoms[0]?.createdAt || null,
        lastRecordDate: symptoms.at(-1)?.createdAt || null
      },
      symptoms: {
        timeline,        // daily series across ALL time
        recent: recentSymptoms
      },
      conversations: {
        totalThreads: convs.length,
        totalMessagesApprox: flatMessages.length,
        recentMessages: flatMessages.slice(-600) // most recent 600 messages
      }
    };

    // Trim if too long (> ~180k chars) by decimating timeline and messages
    const MAX_CHARS = 180_000;
    const toString = (obj) => JSON.stringify(obj);
    let contextStr = toString(PATIENT_CONTEXT);
    if (contextStr.length > MAX_CHARS) {
      // decimate timeline to roughly every Nth day
      const factor = Math.ceil(contextStr.length / MAX_CHARS);
      PATIENT_CONTEXT.symptoms.timeline = PATIENT_CONTEXT.symptoms.timeline.filter((_, i) => i % factor === 0);
      // keep fewer recent messages
      const keep = Math.max(120, Math.floor(600 / factor));
      PATIENT_CONTEXT.conversations.recentMessages = PATIENT_CONTEXT.conversations.recentMessages.slice(-keep);
      contextStr = toString(PATIENT_CONTEXT);
    }
console.log(`Built PATIENT_CONTEXT`,{contextStr});
    // ---------- Create Realtime session with PATIENT_CONTEXT embedded ----------
    const instructions = `
You are a clinical report assistant for healthcare providers.

PATIENT_CONTEXT (JSON):
${contextStr}

Rules:
- Answer ONLY using the PATIENT_CONTEXT above. Do not invent data.
- If asked for a time window (e.g. "past week"), filter using the dates in PATIENT_CONTEXT.
- If the answer requires data older/newer than available, say what's missing.
- Do not diagnose or recommend treatment.

Output style:
- Start with a direct answer (1–2 sentences), then 3–6 concise bullets (key symptoms, trends, notable quotes if any), and include dates where relevant.
    `.trim();

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
        instructions,
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 500, silence_duration_ms: 500 },
        temperature: 0.7,
        max_response_output_tokens: 2000
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log("OpenAI provider-report API error:", errorText);
      return res.status(response.status).json({ error: "Failed to create session", details: errorText });
    }

    // The response contains a client_secret.value (ephemeral key) with these instructions baked in
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("provider-report/token error", error);
    res.status(500).json({ error: "Failed to generate provider report token", details: error.message });
  }
});



export default router;
