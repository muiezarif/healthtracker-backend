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
                recentMessages: flatMessages // most recent 600 messages
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
        console.log(`Built PATIENT_CONTEXT`, { contextStr });
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

// Voice Agent — unified route with SIMULATION / WORKFLOW modes + seeded demo data
// Examples:
//   GET /voice-agent/token
//   GET /voice-agent/token?mode=simulation&clinic=TruCare%20Clinic&agentName=Ava&phone=555-123-4567&location=Suite%20301
//   GET /voice-agent/token?mode=workflow&patient=Sarah%20Johnson
router.get("/voice-agent/token", async (req, res) => {
    try {
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ error: "OpenAI API key not configured" });
        }

        // -------- Query overrides --------
        const voice = String(req.query?.voice || "alloy").trim();
        const mode = (String(req.query?.mode || "simulation").trim().toLowerCase() === "workflow")
            ? "WORKFLOW"
            : "SIMULATION"; // default to Simulation for demos
        const clinicName = String(req.query?.clinic || "Demo Medical Practice").trim();
        const agentName = String(req.query?.agentName || "AI Assistant").trim();
        const clinicPhone = String(req.query?.phone || "(555) 000-0000").trim();
        const clinicLocation = String(req.query?.location || "Main Clinic").trim();
        const focusPatient = String(req.query?.patient || "").trim(); // optional focus

        // -------- Seeded Demo Data (same three patients) --------
        const PATIENTS = [
            {
                id: "demo-sarah-johnson",
                name: "Sarah Johnson",
                dob: "1990-04-12",
                contact: { phone: "(555) 201-7364", email: "sarah.johnson@example.com" },
                appointments: [
                    { id: "apt-sj-001", date: "2025-09-05", time: "10:30", type: "Follow-up", provider: "Dr. Patel", status: "completed", notes: "Discussed recurring headaches" },
                    { id: "apt-sj-002", date: "2025-09-12", time: "09:00", type: "Telehealth", provider: "NP Garcia", status: "scheduled", notes: "Check symptom trend" }
                ],
                inquiries: [
                    { id: "inq-sj-001", date: "2025-09-03", subject: "Headache frequency", message: "Having mild headaches most mornings. Should I adjust caffeine?" },
                    { id: "inq-sj-002", date: "2025-09-07", subject: "Medication question", message: "Is ibuprofen okay if I have to present at work?" }
                ],
                prior_conversation: [
                    { role: "user", text: "I've had mild headaches for the past week." },
                    { role: "assistant", text: "Thanks for sharing. Any fever or changes in appetite?" },
                    { role: "user", text: "No fever, appetite is good. Mostly mornings, stress related maybe." }
                ],
                symptom_summary: "Mild morning headaches x7 days, no fever, good appetite; possible stress trigger."
            },
            {
                id: "demo-michael-chen",
                name: "Michael Chen",
                dob: "1985-11-02",
                contact: { phone: "(555) 414-2289", email: "michael.chen@example.com" },
                appointments: [
                    { id: "apt-mc-001", date: "2025-09-02", time: "16:15", type: "Urgent consult", provider: "Dr. Singh", status: "completed", notes: "Chest discomfort during exercise" },
                    { id: "apt-mc-002", date: "2025-09-16", time: "14:00", type: "Cardio screening", provider: "Dr. Singh", status: "scheduled", notes: "Treadmill test; bring workout log" }
                ],
                inquiries: [
                    { id: "inq-mc-001", date: "2025-09-01", subject: "Exercise pain", message: "Shortness of breath and chest tightness on hills—should I stop running?" }
                ],
                prior_conversation: [
                    { role: "user", text: "I feel chest discomfort when I push my runs harder." },
                    { role: "assistant", text: "Understood. Any dizziness, nausea, or pain radiating to arm/jaw?" },
                    { role: "user", text: "No dizziness or nausea, just tightness that eases with rest." }
                ],
                symptom_summary: "Exertional chest discomfort; resolves with rest; pending treadmill evaluation."
            },
            {
                id: "demo-emma-davis",
                name: "Emma Davis",
                dob: "1997-06-21",
                contact: { phone: "(555) 903-4410", email: "emma.davis@example.com" },
                appointments: [
                    { id: "apt-ed-001", date: "2025-09-10", time: "11:45", type: "New patient intake", provider: "PA Nguyen", status: "scheduled", notes: "Routine physical; immunization review" }
                ],
                inquiries: [
                    { id: "inq-ed-001", date: "2025-09-04", subject: "What to bring", message: "Do I need fasting labs for my physical?" }
                ],
                prior_conversation: [
                    { role: "user", text: "Hi, I’m new. Just need a routine physical." },
                    { role: "assistant", text: "Welcome! Any current symptoms or concerns you’d like to note?" },
                    { role: "user", text: "No major concerns, just want to get established." }
                ],
                symptom_summary: "Asymptomatic; establishing care; routine physical planned."
            }
        ];

        const FOCUSED = focusPatient
            ? PATIENTS.filter(p => p.name.toLowerCase() === focusPatient.toLowerCase())
            : PATIENTS;

        // -------- Instruction block with client requirements + simulation protocol --------
        const instructions = `
You are a professional AI voice assistant for a medical practice.
Always speak in a clear, calm, empathetic, and professional tone.
You are the AI Voice Agent for ${clinicName} named "${agentName}".
Today’s mode: ${mode}.

Seeded demo patient data (JSON):
${JSON.stringify(FOCUSED, null, 2)}

PRIMARY TASKS
- Schedule appointments (check availability, confirm times).
- Make phone calls (introduce yourself, state purpose, confirm details).
- Send reminders (via text/email, short and clear).
- Summarize interactions (concise notes for staff/doctor).
- Always confirm actions before finalizing.
- Never provide medical advice. If clinical questions arise, say: "I will forward this request to your provider."
- If unsure, politely say you’ll forward the request to staff.

CONVERSATION FLOW RULES
1) Greeting:
   - Say: "Hello, this is the automated assistant for ${clinicName}. How may I help you today?"
2) Appointment Scheduling:
   - Ask for name, DOB, and reason for visit.
   - Confirm provider availability (simulate).
   - Respond: "I’ve scheduled you with Dr. [Name] on [Date/Time]. You’ll receive a confirmation by text/email."
3) Phone Call Handling:
   - Outbound: "Hi, this is ${agentName}, calling on behalf of ${clinicName}. I’d like to confirm your appointment for [Date/Time]. Is that still good for you?"
   - Inbound: "I can help you schedule, confirm, or reschedule appointments. What would you like to do?"
4) Text / Email Reminder Templates:
   - EMAIL SUBJECT: "Appointment Confirmation – ${clinicName}"
   - EMAIL/TEXT BODY: "Hello [First Name], your appointment with Dr. [Name] is scheduled for [Date/Time] at ${clinicLocation}. Reply YES to confirm or call us at ${clinicPhone} to reschedule."
5) Staff Summarization Example:
   - Patient: Jane Doe
   - Call Date: Sept 10, 2025
   - Reason: Reschedule annual checkup
   - Action: Appointment moved from Sept 12 → Sept 19, 10 AM
   - Next step: Send confirmation email

MODES
1) SIMULATION MODE (for provider testing):
   - Make it explicit that you are SIMULATING when asked about the process.
   - Walk the full intake workflow: greeting → info collection → scheduling → reminder → summary.
   - Always log the interaction as if a real patient call occurred.
2) WORKFLOW MODE (for provider operations):
   - Accept direct commands (a: Call a patient, b: Send reminder, c: Summarize interactions, d: Escalate to staff).
   - Always confirm before executing.
   - Always generate a structured summary for CRM records.

ACTION SIMULATION PROTOCOL
- For any requested action (book/reschedule, phone call, send reminder, summarize, escalate):
  1) Confirm details with the user.
  2) Respond with a short natural-language confirmation.
  3) Emit an ACTION_LOG JSON block for CRM:
     {
       "action": "schedule_appointment" | "confirm_appointment" | "reschedule_appointment" | "send_reminder" | "outbound_call" | "inbound_call" | "summarize" | "escalate",
       "mode": "${mode}",
       "patient": { "name": "...", "dob": "...", "id": "..." },
       "provider": "Dr. ...",
       "date": "YYYY-MM-DD",
       "time": "HH:mm",
       "channel": "phone|text|email|voice",
       "notes": "short status or outcome",
       "next_step": "what the clinic should do next",
       "timestamp": "<ISO8601>"
     }
  4) Also output a STAFF_SUMMARY section (3–6 bullets, include dates).
- Do not claim to have sent actual messages or changed the real calendar. Use language like "I have simulated..." in SIMULATION mode. In WORKFLOW mode, use "I will proceed to..." after confirmation.

SAFETY
- Never provide medical advice or diagnosis.
- If clinical guidance is requested, say: "I will forward this request to your provider."

QUICK RESPONSES
- If user says "I need an appointment":
  -> Ask for name, reason.
  -> Simulate checking schedule.
  -> Confirm date/time.
  -> Voice: "I’ve booked your appointment for [date/time]. You’ll get a confirmation shortly."
  -> Trigger simulated reminder (use the template).
  -> Log ACTION_LOG and STAFF_SUMMARY.

GREET BRIEFLY and be ready to help with these patients or general clinic tasks.
    `.trim();

        // -------- Create Realtime session --------
        const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-4o-realtime-preview-2024-12-17",
                modalities: ["text", "audio"],
                voice,
                instructions,
                input_audio_transcription: { model: "whisper-1" },
                turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 500, silence_duration_ms: 500 },
                temperature: 0.7,
                max_response_output_tokens: 900
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("OpenAI Voice Agent API error:", errorText);
            return res.status(response.status).json({ error: "Failed to create session", details: errorText });
        }

        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error("voice-agent/token error", err);
        res.status(500).json({ error: "Failed to generate voice agent token", details: err.message });
    }
});

// Voice Agent (Sales) — TRP Agency Sales KB
// Examples:
//   GET /sales-voice-agent/token
//   GET /sales-voice-agent/token?mode=simulation&agentName=Riley&voice=alloy
//   GET /sales-voice-agent/token?mode=workflow&agentName=Riley&calendarLink=https%3A%2F%2Fcal.example.com%2Ftrp
// Modified sales-voice-agent route excerpt
router.get("/sales-voice-agent/token", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    // ---- Query overrides / defaults ----
    const voice = String(req.query?.voice || "alloy").trim();
    const mode =
      String(req.query?.mode || "simulation").trim().toLowerCase() === "workflow"
        ? "WORKFLOW"
        : "SIMULATION";
    const agentName = String(req.query?.agentName || "TRP Sales Assistant").trim();
    const calendarLink = String(req.query?.calendarLink || "").trim();
    const contactEmail = String(req.query?.contactEmail || "sales@trpagency.example").trim();
    const contactPhone = String(req.query?.contactPhone || "(555) 111-2222").trim();

    // ---- TRP Agency – Sales Knowledge Base (baked into instructions) ----
    const SALES_KB = {
      positioning: [
        "TRP Agency specializes in building AI-operated, HIPAA-compliant EHR systems with an integrated Health Tracker for patients.",
        "We automate the processes that drain staff time – so clinics run smoother, patients stay engaged, and providers focus on care.",
        "Every setup is customized to your practice, which is why we recommend a quick call to understand your specific needs."
      ],
      modules: {
        ai_ehr: [
          "Secure patient records & notes",
          "AI voice note-taking & summarization",
          "Automated charting & documentation",
          "Integration with scheduling and billing systems"
        ],
        health_tracker: [
          "Daily voice symptom logging",
          "Remote vitals & lifestyle data import (Apple Health, Fitbit, etc.)",
          "AI summaries to flag trends for providers",
          "Scheduling recommendations based on health patterns"
        ],
        clinic_automations: [
          "Intake forms → auto-populate into EHR",
          "Appointment scheduling (calls, text, online booking)",
          "Follow-up text/email reminders",
          "Automated prescription refill requests",
          "Lab/test result notifications",
          "Billing reminders (insurance or self-pay)",
          "No-show follow-up workflows",
          "Staff task reminders (care coordination, referrals)",
          "Post-visit satisfaction surveys"
        ]
      },
      why_trp: [
        "We bring predictable systems – not roulette.",
        "We optimize for conversions, trust, and outcomes – not vanity metrics.",
        "Our AI confirms what patients already believe: your clinic is the smart, reliable choice.",
        "We protect your time and resources, then multiply results via automation."
      ],
      objections: {
        have_ehr:
          "That's great. We don't replace what works. We integrate automations around your existing system – or build a custom HIPAA-compliant platform if needed. The best next step is a quick call to explore your setup.",
        outsourcing:
          "Not at all. Think of us as insurance against wasted time and missed revenue. Automations reduce staff workload and patient drop-off. Since every clinic is different, let's schedule a call to see what makes sense.",
        price:
          "Pricing depends on clinic size, patient flow, and which automations you need. A short call lets us tailor the system to your exact needs.",
        fit:
          "Our approach removes guesswork. We start by fixing leaks in scheduling, reminders, and engagement – then expand. The next step is a discovery call to map this to your practice."
      },
      cta: [
        "The best way to see if this fits is a quick call with our team. Would you like me to set that up?",
        "Since every practice is unique, the most valuable step is a discovery call. Can I schedule one for you?",
        "Let's book a quick sales call so we can tailor the automations to your clinic."
      ]
    };

    // ---- Instructions block with CRITICAL fix for text output ----
    const instructions = `
You are a professional AI voice assistant for TRP Agency (sales). Your name is "${agentName}".
Speak clearly, calmly, and confidently. Be concise and helpful.

Today's mode: ${mode}.
Contact options: Email ${contactEmail}, Phone ${contactPhone}${
      calendarLink ? `, Booking link: ${calendarLink}` : ""
    }.

KNOWLEDGE BASE
- Core Positioning:
${SALES_KB.positioning.map((l) => `  • ${l}`).join("\n")}
- What We Offer:
  AI-Operated EHR (HIPAA-Compliant)
${SALES_KB.modules.ai_ehr.map((l) => `    • ${l}`).join("\n")}
  Patient Health Tracker
${SALES_KB.modules.health_tracker.map((l) => `    • ${l}`).join("\n")}
  Clinic Automations
${SALES_KB.modules.clinic_automations.map((l) => `    • ${l}`).join("\n")}
- Why Clinics Choose TRP:
${SALES_KB.why_trp.map((l) => `  • ${l}`).join("\n")}
- Objection Handling:
  "We already have an EHR." -> ${SALES_KB.objections.have_ehr}
  "Is this just expensive outsourcing?" -> ${SALES_KB.objections.outsourcing}
  "Can you give me a price?" -> ${SALES_KB.objections.price}
  "What if it doesn't work for our clinic?" -> ${SALES_KB.objections.fit}
- Always Close with a Call to Action:
${SALES_KB.cta.map((l) => `  • ${l}`).join("\n")}

PRIMARY TASKS
- Answer questions about TRP's offering using ONLY the KB above (don't invent details).
- Qualify interest (clinic size, current EHR, pain points, timelines).
- Offer to schedule a discovery/sales call.
- Send a follow-up summary (simulate) and propose next steps.
- Always confirm actions before finalizing.

MODES
1) SIMULATION MODE (for demos):
   - If asked, be explicit that actions are simulated.
   - Walk the flow: greet → clarify needs → explain fit → handle objections → propose call → simulate booking → produce CRM logs.
2) WORKFLOW MODE (live ops):
   - Accept direct commands (a: qualify, b: schedule call, c: send follow-up, d: escalate to human).
   - Confirm details, then proceed and produce CRM logs.

CONVERSATION FLOW
- Greeting: "Hi, this is ${agentName} with TRP Agency. How can I help your clinic today?"
- Discovery: Ask 3–5 concise questions to understand needs (EHR status, staff workload, patient engagement, automations desired).
- Explainer: Map needs to modules/benefits from the KB.
- Objections: Use the scripted responses above. Stay positive and concise.
- CTA: Offer to schedule a discovery call (provide ${calendarLink || "a booking link or times"}).

ACTION SIMULATION PROTOCOL
- For any requested action (qualify_lead, schedule_sales_call, send_followup, escalate):
  1) Confirm key details with the user (date/time if booking, email/phone for follow-up).
  2) Respond with a short natural-language confirmation.
  3) Output an ACTION_LOG JSON block for CRM (as text, not audio).
  4) Output a STAFF_SUMMARY section (3–6 bullets including objections and next steps).
- In SIMULATION mode say "I have simulated ..." for actions. In WORKFLOW mode say "I will proceed ..." after confirmation.

LEAD CAPTURE FLOW - CRITICAL INSTRUCTIONS:
- Ask (one at a time) and confirm:
  1) Contact name (first + last)
  2) Clinic name (if applicable)
  3) Role (owner, admin, provider, etc.)
  4) Email
  5) Phone
  6) Interested modules (choose any: "AI-Operated EHR", "Patient Health Tracker", "Clinic Automations")
  7) Primary goal or pain point (short)
  8) Timeline to start (e.g., "this month", "this quarter")
  9) Consent: "May I save these details to our CRM and Google Sheet so we can follow up?"

CRITICAL: How to output the LEAD_CAPTURE block:
- After the user gives consent, you MUST:
  1) Say verbally (audio): "Perfect! I'm saving your information now."
  2) Then IMMEDIATELY output the following AS TEXT ONLY (not spoken):

[[LEAD_CAPTURE]]
{
  "consent": true,
  "lead": {
    "name": "<First Last>",
    "clinic": "<Clinic or ->",
    "role": "<Role>",
    "email": "<email@domain>",
    "phone": "<+1...>",
    "modules": ["AI-Operated EHR","Patient Health Tracker"],
    "goal": "<short text>",
    "timeline": "<string>"
  },
  "meta": {
    "agentMode": "${mode}",
    "agentName": "${agentName}",
    "timestamp": "<ISO8601>"
  }
}
[[/LEAD_CAPTURE]]

EXTREMELY IMPORTANT RULES for LEAD_CAPTURE:
- This JSON block MUST be output as TEXT content (using the text modality), NOT as audio/speech
- Output it EXACTLY as shown with [[LEAD_CAPTURE]] and [[/LEAD_CAPTURE]] tags
- Do NOT speak/read the JSON aloud - it should only appear in text
- Do NOT put it in code blocks or backticks
- Output it immediately after consent, before any other speech
- After outputting the JSON as text, you can continue speaking normally

To be absolutely clear:
- When it's time to save the lead, use BOTH modalities:
  - AUDIO: Say "Perfect! I'm saving your information now."
  - TEXT: Output the [[LEAD_CAPTURE]] JSON block
- The JSON must appear in the text stream, not the audio transcript

STYLE
- Keep answers crisp (5–8 sentences max before pausing).
- Use bullets for lists. Avoid jargon.
- If asked for pricing, explain it's tailored and propose a call.

SAFETY
- Do not provide legal or clinical advice. Redirect such questions to a human specialist if needed.
`.trim();

    // ---- Create Realtime session with forced text output ----
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        modalities: ["text", "audio"], // Both modalities enabled
        voice,
        instructions,
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 500,
          silence_duration_ms: 500
        },
        temperature: 0.7,
        max_response_output_tokens: 900
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI Sales Agent API error:", errorText);
      return res.status(response.status).json({ error: "Failed to create session", details: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("sales-voice-agent/token error", err);
    res.status(500).json({ error: "Failed to generate sales voice agent token", details: err.message });
  }
});


// Voice Agent (Sales) — NOVAM Agency
// Example:
//   GET /sales-voice-agent-novam/token
//   GET /sales-voice-agent-novam/token?mode=simulation&agentName=Nova&voice=alloy
router.get("/sales-voice-agent-novam/token", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const voice = String(req.query?.voice || "alloy").trim();
    const mode =
      String(req.query?.mode || "simulation").trim().toLowerCase() === "workflow"
        ? "WORKFLOW"
        : "SIMULATION";
    const agentName = String(req.query?.agentName || "Novam Assistant").trim();
    const calendarLink = String(req.query?.calendarLink || "").trim();
    const contactEmail = String(req.query?.contactEmail || "hello@novamagency.com").trim();
    const contactPhone = String(req.query?.contactPhone || "(555) 987-6543").trim();

    // ---- NOVAM Agency Sales Knowledge Base ----
    const SALES_KB = {
      positioning: [
        "Novam is a software and digital marketing agency helping clients bring their dreams to life.",
        "We build, optimize, and scale digital ecosystems — from custom software and automation to branding, web design, and lead generation.",
        "Our mission is to help businesses grow faster, smarter, and more sustainably through tailored tech and marketing strategies."
      ],
      services: {
        software: [
          "Custom web and mobile app development",
          "AI-powered business tools and automations",
          "SaaS product design and launch support",
          "CRM, API, and backend integrations"
        ],
        marketing: [
          "Brand strategy and identity design",
          "Website design & conversion optimization",
          "Paid advertising (Google, Meta, LinkedIn)",
          "Content marketing and SEO growth systems"
        ],
        consulting: [
          "Digital transformation strategy",
          "Automation and workflow optimization",
          "Funnel and sales system design",
          "Analytics, reporting, and CRO consulting"
        ]
      },
      why_novam: [
        "We combine creative design with data-driven strategy.",
        "Our team acts as an extension of your business — not just a vendor.",
        "We focus on outcomes that matter: growth, efficiency, and customer trust.",
        "Every project is built with scalability, automation, and long-term ROI in mind."
      ],
      objections: {
        have_team:
          "That’s great — we often collaborate with internal teams. We can handle the technical or creative heavy lifting so your team stays focused on their strengths.",
        price:
          "We tailor every solution to your goals and budget. Let’s schedule a quick call to understand your needs and give you a clear proposal.",
        unsure:
          "No problem — we can start with a free discovery session to clarify your goals and identify where Novam can help most.",
        busy:
          "Totally understand. That’s why we handle end-to-end execution so you can focus on running your business while we accelerate your digital growth."
      },
      cta: [
        "Would you like to schedule a quick discovery call to explore how Novam can help?",
        "The best way to start is with a short strategy session. Can I set that up for you?",
        "Let’s book a 15-minute call to see what’s possible for your business."
      ]
    };

    const instructions = `
You are a professional AI voice assistant representing Novam — a software and digital marketing agency that helps clients build their dreams and grow their businesses.
Your name is "${agentName}". Speak confidently, warmly, and with entrepreneurial enthusiasm.

Today's mode: ${mode}.
Contact options: Email ${contactEmail}, Phone ${contactPhone}${
      calendarLink ? `, Booking link: ${calendarLink}` : ""
    }.

KNOWLEDGE BASE
- Who We Are:
${SALES_KB.positioning.map((l) => `  • ${l}`).join("\n")}
- Core Services:
  Software Development
${SALES_KB.services.software.map((l) => `    • ${l}`).join("\n")}
  Digital Marketing
${SALES_KB.services.marketing.map((l) => `    • ${l}`).join("\n")}
  Consulting & Strategy
${SALES_KB.services.consulting.map((l) => `    • ${l}`).join("\n")}
- Why Clients Choose Novam:
${SALES_KB.why_novam.map((l) => `  • ${l}`).join("\n")}
- Objection Handling:
  "We already have a team." -> ${SALES_KB.objections.have_team}
  "What’s the price?" -> ${SALES_KB.objections.price}
  "Not sure if this is a fit." -> ${SALES_KB.objections.unsure}
  "We’re too busy right now." -> ${SALES_KB.objections.busy}
- Call to Action:
${SALES_KB.cta.map((l) => `  • ${l}`).join("\n")}

PRIMARY TASKS
- Explain Novam’s services clearly using only the info above.
- Qualify potential clients (business type, goals, current challenges).
- Offer to schedule a discovery call.
- Confirm all details before saving leads.
- Output structured CRM logs when lead data is collected.

LEAD CAPTURE PROTOCOL
After confirming consent, output a [[LEAD_CAPTURE]] JSON block (as TEXT ONLY, not spoken):
[[LEAD_CAPTURE]]
{
  "consent": true,
  "lead": {
    "name": "<Full Name>",
    "company": "<Business Name>",
    "role": "<Role>",
    "email": "<email@domain>",
    "phone": "<+1...>",
    "services": ["Software Development","Digital Marketing"],
    "goal": "<short business goal or challenge>",
    "timeline": "<e.g. this month, this quarter>"
  },
  "meta": {
    "agentMode": "${mode}",
    "agentName": "${agentName}",
    "timestamp": "<ISO8601>"
  }
}
[[/LEAD_CAPTURE]]

RULES
- Never read the JSON aloud — it must appear in text output only.
- Always confirm before saving info or scheduling calls.
- In SIMULATION mode, say “I’m simulating this action.” In WORKFLOW mode, say “I will proceed.”
- Keep answers short, clear, and conversational.
- Avoid jargon — focus on benefits and clarity.

STYLE
- Friendly, confident, and inspiring.
- Use conversational flow — ask one question at a time.
- Speak as a partner helping build their success, not a salesperson.

SAFETY
- No legal, financial, or personal advice — redirect to human support if needed.
`.trim();

    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        modalities: ["text", "audio"],
        voice,
        instructions,
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 500,
          silence_duration_ms: 500
        },
        temperature: 0.7,
        max_response_output_tokens: 900
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI Novam Agent API error:", errorText);
      return res.status(response.status).json({ error: "Failed to create session", details: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("sales-voice-agent-novam/token error", err);
    res.status(500).json({ error: "Failed to generate Novam sales voice agent token", details: err.message });
  }
});








export default router;
