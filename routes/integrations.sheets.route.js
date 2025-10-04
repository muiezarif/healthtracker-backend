import express from "express";
import { google } from "googleapis";

const router = express.Router();

// Expect env:
// GOOGLE_CLIENT_EMAIL=...@...gserviceaccount.com
// GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
// SALES_SHEET_ID=1AbcDEFghiJKLmnOPQRstuVWxyz12345   (the spreadsheet ID)
// Optionally: SALES_SHEET_TAB=Leads
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
  return google.sheets({ version: "v4", auth });
}

router.post("/integrations/sheets/lead", async (req, res) => {
  try {
    const {
      consent,
      lead = {},   // { name, clinic, role, email, phone, modules[], goal, timeline }
      meta = {},   // { agentMode, agentName, timestamp }
    } = req.body || {};

    if (!consent) return res.status(400).json({ error: "Consent is required before saving." });

    const {
      name = "",
      clinic = "",
      role = "",
      email = "",
      phone = "",
      modules = [],
      goal = "",
      timeline = "",
    } = lead;

    const agentMode = meta.agentMode || "";
    const agentName = meta.agentName || "";
    const ts = meta.timestamp || new Date().toISOString();

    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SALES_SHEET_ID;
    const tab = process.env.SALES_SHEET_TAB || "Leads";
    const range = `${tab}!A1`;

    // Ensure the service account has edit access to the sheet (share it with GOOGLE_CLIENT_EMAIL)
    const values = [[
      ts,
      name,
      clinic,
      role,
      email,
      phone,
      (Array.isArray(modules) ? modules.join(", ") : ""),
      goal,
      timeline,
      agentMode,
      agentName,
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Sheets append error:", err);
    res.status(500).json({ error: "Failed to append to Google Sheet", details: err.message });
  }
});

// --- NOVAM Sheets Integration: Save Lead (Simplified) ---
// Env required:
//   GOOGLE_CLIENT_EMAIL=...@gserviceaccount.com
//   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
//   SALES_SHEET_NOVAM_ID=1AbcDEFghiJKLmnOPQRstuVWxyz12345
// Optional:
//   SALES_SHEET_NOVAM_TAB=Leads
router.post("/integrations-novam/sheets/lead", async (req, res) => {
  try {
    const {
      consent,
      lead = {},   // { name, email, company }
      meta = {},   // { agentMode, agentName, timestamp }
    } = req.body || {};

    if (!consent) {
      return res.status(400).json({ error: "Consent is required before saving." });
    }

    const fullName = lead.name || "";
    const email = lead.email || "";
    const company = lead.company || "";

    if (!fullName || !email || !company) {
      return res.status(400).json({ error: "Missing required lead fields: name, email, or company." });
    }

    const agentMode = meta.agentMode || "";
    const agentName = meta.agentName || "";
    const timestamp = meta.timestamp || new Date().toISOString();

    // --- Sheets setup ---
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SALES_SHEET_NOVAM_ID;
    const tab = process.env.SALES_SHEET_NOVAM_TAB || "NovamLeads";

    if (!spreadsheetId) {
      return res.status(500).json({ error: "SALES_SHEET_NOVAM_ID env is missing" });
    }

    // Row format:
    // A: Timestamp | B: Full Name | C: Email | D: Company | E: Agent Mode | F: Agent Name | G: Source
    const values = [[
      timestamp,
      fullName,
      email,
      company,
      agentMode,
      agentName,
      "Novam",
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Novam Sheets append error:", err);
    res.status(500).json({
      error: "Failed to append to Novam Google Sheet",
      details: err.message,
    });
  }
});



export default router;
