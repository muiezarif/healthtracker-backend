import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import cors from "cors";
// import bodyParser from "body-parser"; // not needed; express has built-ins
// import WebSocket from "ws";           // not used
import authRoutes from "./routes/auth.route.js";
import adminRoutes from "./routes/admin.route.js";
import patientRoutes from "./routes/patient.route.js";
import providerRoutes from "./routes/provider.route.js";
import { WebSocketServer } from "ws";
import { createServer } from "http";

dotenv.config();

const app = express();
const server = createServer(app);



app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true
}));
// Make sure preflights are answered for every route

// --- WebSocket server for handling real-time connections ---
// const wss = new WebSocketServer({ server });
const activeSessions = new Map();

// Symptom gathering questions and session management
const SYMPTOM_QUESTIONS = [
  "To start, is your symptom physical, mental, or emotional?",
  "What is the symptom you’re experiencing?",
  "On a scale of 1 to 10, how severe is it right now?",
  "Please describe what you’re feeling in more detail.",
  "Any additional notes or context (triggers, timing, other details) you’d like to add?",
];

// class SymptomSession {
//   constructor(sessionId) {
//     this.sessionId = sessionId;
//     this.currentQuestionIndex = 0;
//     this.patientData = {
//       symptom_type: "", // step 1
//       symptom: "", // step 2
//       severity_level: "", // step 3 (number 1-10)
//       description: "", // step 4
//       additional_notes: "", // step 5
//     };
//     this.isComplete = false;
//   }

//   getCurrentQuestion() {
//     if (this.currentQuestionIndex < SYMPTOM_QUESTIONS.length) {
//       return SYMPTOM_QUESTIONS[this.currentQuestionIndex];
//     }
//     return "Thanks! I’ve recorded your answers.";
//   }

//   // Map each step’s response into the schema fields
//   recordResponse(response) {
//     const fieldMapping = [
//       "symptom_type", // 0
//       "symptom", // 1
//       "severity_level", // 2
//       "description", // 3
//       "additional_notes", // 4
//     ];

//     // mild normalization for step 1 + step 3
//     if (this.currentQuestionIndex === 0) {
//       const v = String(response || "").toLowerCase();
//       if (v.includes("phys")) response = "physical";
//       else if (v.includes("ment")) response = "mental";
//       else if (v.includes("emo")) response = "emotional";
//     }
//     if (this.currentQuestionIndex === 2) {
//       // pull the first number 1-10 mentioned
//       const m = String(response).match(/\b(10|[1-9])\b/);
//       response = m ? Number(m[1]) : "";
//     }

//     if (this.currentQuestionIndex < fieldMapping.length) {
//       this.patientData[fieldMapping[this.currentQuestionIndex]] = response;
//     }

//     this.currentQuestionIndex++;
//     if (this.currentQuestionIndex >= SYMPTOM_QUESTIONS.length) {
//       this.isComplete = true;
//     }
//   }

//   getNextQuestion() {
//     if (this.isComplete) {
//       return "Thank you — your symptom information has been recorded for the care team.";
//     }
//     return this.getCurrentQuestion();
//   }
// }

// Handle WebSocket connections for session management
// wss.on("connection", (ws) => {
//   console.log("Client connected");
//   const sessionId = Date.now().toString();
//   const symptomSession = new SymptomSession(sessionId);
//   activeSessions.set(sessionId, symptomSession);

//   ws.on("message", (data) => {
//     try {
//       const message = JSON.parse(data.toString());

//       switch (message.type) {
//         case "start_session":
//           ws.send(
//             JSON.stringify({
//               type: "session_ready",
//               sessionId: sessionId,
//               message:
//                 "Session started. Please use the /token endpoint to get your ephemeral token.",
//             })
//           );
//           break;

//         case "record_response":
//           symptomSession.recordResponse(message.response);

//           if (symptomSession.isComplete) {
//             ws.send(
//               JSON.stringify({
//                 type: "session_complete",
//                 data: symptomSession.patientData,
//               })
//             );
//           } else {
//             ws.send(
//               JSON.stringify({
//                 type: "next_question",
//                 question: symptomSession.getNextQuestion(),
//                 questionIndex: symptomSession.currentQuestionIndex,
//               })
//             );
//           }
//           break;

//         case "get_current_question":
//           ws.send(
//             JSON.stringify({
//               type: "current_question",
//               question: symptomSession.getCurrentQuestion(),
//               questionIndex: symptomSession.currentQuestionIndex,
//               isComplete: symptomSession.isComplete,
//             })
//           );
//           break;
//       }
//     } catch (error) {
//       console.error("Error handling WebSocket message:", error);
//       ws.send(
//         JSON.stringify({
//           type: "error",
//           message: "Failed to process message",
//         })
//       );
//     }
//   });

//   ws.on("close", () => {
//     console.log("Client disconnected");
//     activeSessions.delete(sessionId);
//   });

//   ws.on("error", (error) => {
//     console.error("WebSocket error:", error);
//   });
// });

// --- DB Connection ---
const db_connect = async () => {
  try {
    await mongoose.connect(process.env.MONGO_DB_URL);
    console.log("Connected to mongodb");
  } catch (error) {
    throw error;
  }
};

// --- Middlewares ---
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Health Tracker API - Running");
});

// Token endpoint for OpenAI Realtime API
// app.get("/api/token", async (req, res) => {
//   try {
//     if (!process.env.OPENAI_API_KEY) {
//       return res.status(500).json({ error: "OpenAI API key not configured" });
//     }

//     const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({
//         model: "gpt-4o-realtime-preview-2024-12-17",
//         voice: "alloy",
//         instructions: `You are a clinical intake assistant helping a clinician collect a concise, structured symptom entry.
// Ask exactly these five questions in order, one at a time (wait for the patient's answer before the next):
// 1) “Is your symptom physical, mental, or emotional?”
// 2) “What symptom are you experiencing?”
// 3) “On a scale from 1 to 10, how severe is it right now?”
// 4) “Please describe what you’re feeling in more detail.”
// 5) “Any additional notes or context (triggers, timing, other details)?”

// Be brief, empathetic, and do not ask extra questions.`,
//         input_audio_transcription: { model: "whisper-1" },
//         turn_detection: {
//           type: "server_vad",
//           threshold: 0.5,
//           prefix_padding_ms: 300,
//           silence_duration_ms: 500,
//         },
//         temperature: 0.7,
//         max_response_output_tokens: 2048,
//       }),
//     });

//     if (!response.ok) {
//       const errorText = await response.text();
//       console.error("OpenAI API error:", errorText);
//       return res.status(response.status).json({
//         error: "Failed to create session",
//         details: errorText,
//       });
//     }

//     const data = await response.json();
//     res.json(data);
//   } catch (error) {
//     console.error("Token generation error:", error);
//     res.status(500).json({ error: "Failed to generate token" });
//   }
// });

// // Get session data endpoint
// app.get("/api/sessions/:sessionId", (req, res) => {
//   const session = activeSessions.get(req.params.sessionId);
//   if (session) {
//     res.json({
//       sessionId: req.params.sessionId,
//       currentQuestion: session.currentQuestionIndex,
//       isComplete: session.isComplete,
//       patientData: session.patientData,
//       currentQuestionText: session.getCurrentQuestion(),
//     });
//   } else {
//     res.status(404).json({ error: "Session not found" });
//   }
// });

// // Save session data endpoint
// app.post("/api/sessions/:sessionId/save", (req, res) => {
//   const session = activeSessions.get(req.params.sessionId);
//   if (session && session.isComplete) {
//     console.log("Saving patient data:", session.patientData);

//     res.json({
//       success: true,
//       message: "Patient symptoms recorded successfully",
//       data: session.patientData,
//     });
//   } else {
//     res.status(400).json({ error: "Session not complete or not found" });
//   }
// });

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    activeSessions: activeSessions.size,
  });
});

// Routes
// app.use("/api/auth", authRoutes);
// app.use("/api/admin", adminRoutes);
// app.use("/api/patient", patientRoutes);
// app.use("/api/provider", providerRoutes);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Server error:", error);
  res.status(500).json({
    error: "Internal server error",
    message: error.message,
  });
});

// Start server with WebSocket support
const PORT = process.env.PORT || 8800;
server.listen(PORT, function () {
  db_connect();
  console.log(`🚀 Express server listening on port ${PORT} in ${app.settings.env} mode`);
  console.log(`📡 WebSocket server ready for connections`);
  console.log(`🏥 Health Tracker API ready`);
});
