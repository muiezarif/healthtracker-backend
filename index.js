import express from "express"
import dotenv from "dotenv"
import mongoose from "mongoose"
import cookieParser from "cookie-parser"
import cors from "cors"
import bodyParser from "body-parser"
import WebSocket from 'ws'
import authRoutes from './routes/auth.route.js';
import adminRoutes from './routes/admin.route.js';
import patientRoutes from './routes/patient.route.js';
import providerRoutes from './routes/provider.route.js';
import voiceAgentRoutes from './routes/voice-agent.route.js';
import conversationRoutes from "./routes/conversation.route.js";

import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const app = express();

app.set('trust proxy', 1);
dotenv.config();
const server = createServer(app);

// WebSocket server for handling real-time connections
const wss = new WebSocketServer({ server });
const activeSessions = new Map();

// (Legacy) Symptom Qs used by the simple WS flow if you still use it somewhere.
// NOTE: We no longer ask for "type". The agent will infer it from the symptom.
const SYMPTOM_QUESTIONS = [
  "What symptom are you experiencing?",
  "On a scale of 1 to 10, how severe is it right now?",
  "Please describe what you're feeling in more detail.",
  "Any additional notes or context (triggers, timing, other details) you'd like to add?"
];

class SymptomSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.currentQuestionIndex = 0;
    this.patientData = {
      symptom_type: '',
      symptom: '',
      severity_level: '',
      description: '',
      additional_notes: ''
    };
    this.isComplete = false;
    this.peerConnection = null;
    this.dataChannel = null;
  }

  getCurrentQuestion() {
    if (this.currentQuestionIndex < SYMPTOM_QUESTIONS.length) {
      return SYMPTOM_QUESTIONS[this.currentQuestionIndex];
    }
    return "Thanks, I have everything I need for now.";
  }

  recordResponse(response) {
    // New order: 0:symptom, 1:severity, 2:description, 3:additional_notes
    const fieldMapping = [
      'symptom', 'severity_level', 'description', 'additional_notes'
    ];

    let val = response;

    if (this.currentQuestionIndex === 1) {
      // severity
      const m = String(response).match(/\b(10|[1-9])\b/);
      val = m ? Number(m[1]) : '';
    }

    if (this.currentQuestionIndex < fieldMapping.length) {
      this.patientData[fieldMapping[this.currentQuestionIndex]] = val;
    }

    // Try a coarse categorization on the server too (optional; frontend also does this)
    if (this.currentQuestionIndex === 0 || this.currentQuestionIndex === 2) {
      const cat = categorizeSymptomServer(
        this.patientData.symptom || '',
        (this.patientData.description || '') + ' ' + (response || '')
      );
      if (cat) this.patientData.symptom_type = cat;
    }

    this.currentQuestionIndex++;
    if (this.currentQuestionIndex >= SYMPTOM_QUESTIONS.length) {
      this.isComplete = true;
    }
  }

  getNextQuestion() {
    if (this.isComplete) {
      return "Thank you — your symptom information has been recorded for the care team.";
    }
    return this.getCurrentQuestion();
  }
}

// simple keyword categorizer for server (frontend has its own, richer one)
function categorizeSymptomServer(symptomText, description) {
  const text = `${symptomText} ${description}`.toLowerCase();
  const physicalKeys = ['pain', 'ache', 'fever', 'cough', 'nausea', 'vomit', 'dizziness', 'rash', 'injury', 'cramp', 'chest', 'breath', 'headache', 'throat', 'stomach', 'diarrhea', 'fatigue', 'swelling', 'back', 'arm', 'leg', 'ear', 'nose', 'flu', 'cold'];
  const mentalKeys = ['focus', 'memory', 'concentrat', 'insomnia', 'sleep', 'adhd', 'brain fog', 'confus', 'hallucin', 'delusion', 'cognitive'];
  const emotionalKeys = ['anxiety', 'anxious', 'depress', 'sad', 'mood', 'anger', 'irritab', 'stress', 'panic', 'fear', 'lonely'];

  const hits = (keys) => keys.some(k => text.includes(k));
  if (hits(emotionalKeys)) return 'emotional';
  if (hits(mentalKeys)) return 'mental';
  if (hits(physicalKeys)) return 'physical';
  return '';
}

// Handle WebSocket connections (optional legacy pathway)
wss.on('connection', (ws) => {
  console.log('Client connected');
  let sessionId = Date.now().toString();
  let symptomSession = new SymptomSession(sessionId);
  activeSessions.set(sessionId, symptomSession);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      switch (message.type) {
        case 'start_session':
          ws.send(JSON.stringify({
            type: 'session_ready',
            sessionId,
            message: 'Session started. Use /api/token to get your ephemeral token for the Realtime client.'
          }));
          break;

        case 'record_response':
          symptomSession.recordResponse(message.response);
          if (symptomSession.isComplete) {
            ws.send(JSON.stringify({ type: 'session_complete', data: symptomSession.patientData }));
          } else {
            ws.send(JSON.stringify({
              type: 'next_question',
              question: symptomSession.getNextQuestion(),
              questionIndex: symptomSession.currentQuestionIndex
            }));
          }
          break;

        case 'get_current_question':
          ws.send(JSON.stringify({
            type: 'current_question',
            question: symptomSession.getCurrentQuestion(),
            questionIndex: symptomSession.currentQuestionIndex,
            isComplete: symptomSession.isComplete
          }));
          break;
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Failed to process message' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    activeSessions.delete(sessionId);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// DB Connection
const db_connect = async () => {
  try {
    await mongoose.connect(process.env.MONGO_DB_URL)
    console.log("Connected to mongodb")
  } catch (error) {
    throw error
  }
}

// Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser())
app.use(express.json())
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => res.send("Health Tracker API - Running"));



// Simple session endpoints (optional)
app.get('/api/sessions/:sessionId', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (session) {
    res.json({
      sessionId: req.params.sessionId,
      currentQuestion: session.currentQuestionIndex,
      isComplete: session.isComplete,
      patientData: session.patientData,
      currentQuestionText: session.getCurrentQuestion()
    });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

app.post('/api/sessions/:sessionId/save', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (session && session.isComplete) {
    console.log('Saving patient data:', session.patientData);
    res.json({
      success: true,
      message: 'Patient symptoms recorded successfully',
      data: session.patientData
    });
  } else {
    res.status(400).json({ error: 'Session not complete or not found' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeSessions: activeSessions.size
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/provider', providerRoutes);
app.use('/api/voice-agent', voiceAgentRoutes);
app.use("/api/conversations", conversationRoutes);

// Error handling
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error', message: error.message });
});

// Start
const PORT = process.env.PORT || 8800;
server.listen(PORT, function () {
  db_connect()
  console.log(`🚀 Express server listening on port ${PORT} in ${app.settings.env} mode`);
  console.log(`📡 WebSocket server ready for connections`);
  console.log(`🏥 Health Tracker API ready`);
});
