import express from 'express';
import dotenv from "dotenv"
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

export default router;
