
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

// ===============================
// ENV
// ===============================
const PORT = process.env.PORT || 3000;
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_API_BASE = "https://services.leadconnectorhq.com";

console.log("API KEY LOADED:", GHL_API_KEY ? "YES" : "NO");

// ===============================
// BASIC ROUTE
// ===============================
app.get("/", (req, res) => {
  res.json({ status: "backend running" });
});

// ===============================
// MAIN BOOTSTRAP (NO SEARCH)
// ===============================
app.post("/bootstrap-demo", async (req, res) => {
  try {
    const {
      sessionId,
      existingContactId,
      company,
      service,
      website,
      firstName,
      email,
      phone,
      city
    } = req.body || {};

    let contactId = existingContactId || null;

    // 🔥 NO SEARCH — CREATE OR UPDATE ONLY
    if (!contactId) {
      console.log("🆕 Creating new contact...");
      contactId = await createContact({
        firstName,
        email,
        phone,
        company,
        service,
        website,
        city,
        sessionId
      });
    } else {
      console.log("🔁 Updating contact:", contactId);
      await updateContact(contactId, {
        firstName,
        email,
        phone,
        company,
        service,
        website,
        city,
        sessionId
      });
    }

    // 🔥 ADD SUMMARY + PREVIEW
    const previewUrl = buildPreviewUrl(website);
    const summary = buildSummary({ company, service, website, city });

    await updateContact(contactId, {
      summary,
      previewUrl
    });

    res.json({
      ok: true,
      contactId,
      sessionId,
      previewUrl,
      summary
    });

  } catch (error) {
    console.error("❌ ERROR:", error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// ===============================
// HEADERS (PRIVATE INTEGRATION SAFE)
// ===============================
function ghlHeaders(extra = {}) {
  if (!GHL_API_KEY) {
    throw new Error("Missing GHL_API_KEY");
  }

  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    Version: "2021-07-28",
    Accept: "application/json",
    "Content-Type": "application/json",
    ...extra
  };
}

// ===============================
// CREATE CONTACT
// ===============================
async function createContact(data) {

  const payload = {
    firstName: data.firstName || "Guest",
    lastName: "Visitor",
    phone: data.phone,
    email: data.email,
    companyName: data.company,
    customFields: [
      { key: "sr_session_id", field_value: data.sessionId },
      { key: "sr_company", field_value: data.company },
      { key: "sr_service", field_value: data.service },
      { key: "sr_website", field_value: data.website },
      { key: "sr_city", field_value: data.city }
    ]
  };

  const res = await fetch(`${GHL_API_BASE}/contacts/`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify(payload)
  });

  const json = await res.json();

  if (!res.ok) {
    console.error("❌ CREATE ERROR:", json);
    throw new Error("Create failed");
  }

  return json.contact?.id || json.id;
}

// ===============================
// UPDATE CONTACT
// ===============================
async function updateContact(contactId, data) {

  const customFields = [];

  if (data.sessionId) customFields.push({ key: "sr_session_id", field_value: data.sessionId });
  if (data.company) customFields.push({ key: "sr_company", field_value: data.company });
  if (data.service) customFields.push({ key: "sr_service", field_value: data.service });
  if (data.website) customFields.push({ key: "sr_website", field_value: data.website });
  if (data.city) customFields.push({ key: "sr_city", field_value: data.city });
  if (data.summary) customFields.push({ key: "sr_demo_summary", field_value: data.summary });
  if (data.previewUrl) customFields.push({ key: "sr_preview_url", field_value: data.previewUrl });

  const payload = {
    firstName: data.firstName,
    email: data.email,
    phone: data.phone,
    companyName: data.company,
    customFields
  };

  const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify(payload)
  });

  const json = await res.json();

  if (!res.ok) {
    console.error("❌ UPDATE ERROR:", json);
    throw new Error("Update failed");
  }

  return json;
}

// ===============================
// HELPERS
// ===============================
function buildPreviewUrl(site) {
  if (!site) return "";

  const url = site.startsWith("http") ? site : `https://${site}`;

  return `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&isMobile=true`;
}

function buildSummary({ company, service, website, city }) {
  return `
Business: ${company}
Service: ${service}
Website: ${website}
City: ${city}
Live demo lead. Speak naturally.
`.trim();
}

// ===============================
app.listen(PORT, () => {
  console.log(`✅ Server running on ${PORT}`);
});