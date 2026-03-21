
const express = require("express");
const cors = require("cors");
require("dotenv").config();

// Node 18+ has global fetch.
// If your Render service is older Node, uncomment the next line:
// const fetch = require("node-fetch");

const app = express();

app.use(cors());
app.use(express.json());


// ✅ ADD IT RIGHT HERE
console.log("API KEY LOADED:", process.env.GHL_API_KEY ? "YES" : "NO");

// Optional (very helpful)
console.log("API KEY LENGTH:", process.env.GHL_API_KEY?.length);

console.log("LOCATION ID:", GHL_LOCATION_ID);

const PORT = process.env.PORT || 3000;
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

// Optional if your token requires location scoping
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || "";

if (!GHL_API_KEY) {
  console.warn("⚠️ Missing GHL_API_KEY in environment variables.");
}

// -----------------------------------
// BASIC ROUTE
// -----------------------------------
app.get("/", (req, res) => {
  res.json({ status: "backend running" });
});

// -----------------------------------
// MAIN BOOTSTRAP ROUTE
// -----------------------------------
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

    // 1) Primary lookup by phone
    if (!contactId && phone) {
      console.log("🔍 Searching by phone:", phone);
      contactId = await findContactByPhone(phone);
    }

    // 2) Secondary lookup by email
    if (!contactId && email) {
      console.log("🔍 Searching by email:", email);
      contactId = await findContactByEmail(email);
    }

    // 3) Fallback by sessionId
    if (!contactId && sessionId) {
      console.log("🔍 Searching by sessionId:", sessionId);
      contactId = await findContactBySessionId(sessionId);
    }

    // 4) Create or update
    if (!contactId) {
      console.log("🆕 No contact found. Creating new contact...");
      contactId = await createDemoContact({
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
      console.log("🔁 Existing contact found. Updating:", contactId);
      await updateDemoContact(contactId, {
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

    // 5) Add summary + previewUrl
    const previewUrl = buildPreviewUrl(website);
    const summary = buildDemoSummary({ company, service, website, city });

    await updateDemoContact(contactId, {
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
    console.error("❌ /bootstrap-demo error:", error);
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to bootstrap demo"
    });
  }
});

// -----------------------------------
// GHL HELPERS
// -----------------------------------
function ghlHeaders(extra = {}) {

  if (!GHL_API_KEY) {
    throw new Error("❌ Missing GHL_API_KEY");
  }

  if (!GHL_LOCATION_ID) {
    throw new Error("❌ Missing GHL_LOCATION_ID");
  }

  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    Version: "2021-07-28",
    Accept: "application/json",
    "Content-Type": "application/json",
    "Location-Id": GHL_LOCATION_ID, // 🔥 ALWAYS INCLUDED
    ...extra
  };
}

function normalizePhoneForCompare(phone) {
  return (phone || "").replace(/\D/g, "");
}

async function ghlSearchContacts(query) {
  const url = `${GHL_API_BASE}/contacts/search?query=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: ghlHeaders()
  });

  const data = await safeJson(response);

  if (!response.ok) {
    console.error("GHL search failed:", data);
    throw new Error(`GHL search failed with status ${response.status}`);
  }

  return data;
}

async function findContactByPhone(phone) {
  const data = await ghlSearchContacts(phone);
  const target = normalizePhoneForCompare(phone);

  const contact = (data.contacts || []).find((c) => {
    const cPhone = normalizePhoneForCompare(c.phone || "");
    return cPhone && (cPhone === target || cPhone.endsWith(target.slice(-10)));
  });

  return contact ? contact.id : null;
}

async function findContactByEmail(email) {
  const data = await ghlSearchContacts(email);
  const target = (email || "").trim().toLowerCase();

  const contact = (data.contacts || []).find((c) => {
    const cEmail = (c.email || "").trim().toLowerCase();
    return cEmail && cEmail === target;
  });

  return contact ? contact.id : null;
}

async function findContactBySessionId(sessionId) {
  const data = await ghlSearchContacts(sessionId);

  const contact = (data.contacts || []).find((c) => {
    const customFields = c.customFields || c.custom_fields || [];
    return customFields.some((field) => {
      const fieldValue = field.value ?? field.field_value ?? "";
      const fieldKey = field.key ?? field.name ?? "";
      return fieldValue === sessionId || fieldKey === "sr_session_id";
    }) && customFields.some((field) => {
      const fieldValue = field.value ?? field.field_value ?? "";
      return fieldValue === sessionId;
    });
  });

  return contact ? contact.id : null;
}

async function createDemoContact({
  firstName,
  email,
  phone,
  company,
  service,
  website,
  city,
  sessionId
}) {
  const payload = {
    firstName: firstName || "Guest",
    lastName: "Visitor",
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(company ? { companyName: company } : {}),
    customFields: [
      { key: "sr_session_id", field_value: sessionId || "" },
      { key: "sr_company", field_value: company || "" },
      { key: "sr_service", field_value: service || "" },
      { key: "sr_website", field_value: website || "" },
      { key: "sr_city", field_value: city || "" }
    ]
  };

  const response = await fetch(`${GHL_API_BASE}/contacts/`, {
    method: "POST",
    headers: ghlHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify(payload)
  });

  const data = await safeJson(response);

  if (!response.ok) {
    console.error("Create contact failed:", data);
    throw new Error(`Failed to create contact: ${response.status}`);
  }

  const contactId = data.contact?.id || data.id;
  if (!contactId) {
    throw new Error("Create contact succeeded but no contact id returned.");
  }

  return contactId;
}

async function updateDemoContact(contactId, fields) {
  const customFields = [];

  if (fields.sessionId) {
    customFields.push({ key: "sr_session_id", field_value: fields.sessionId });
  }
  if (fields.company) {
    customFields.push({ key: "sr_company", field_value: fields.company });
  }
  if (fields.service) {
    customFields.push({ key: "sr_service", field_value: fields.service });
  }
  if (fields.website) {
    customFields.push({ key: "sr_website", field_value: fields.website });
  }
  if (fields.city) {
    customFields.push({ key: "sr_city", field_value: fields.city });
  }
  if (fields.summary) {
    customFields.push({ key: "sr_demo_summary", field_value: fields.summary });
  }
  if (fields.previewUrl) {
    customFields.push({ key: "sr_preview_url", field_value: fields.previewUrl });
  }

  const payload = {
    ...(fields.firstName ? { firstName: fields.firstName } : {}),
    ...(fields.email ? { email: fields.email } : {}),
    ...(fields.phone ? { phone: fields.phone } : {}),
    ...(fields.company ? { companyName: fields.company } : {}),
    ...(customFields.length ? { customFields } : {})
  };

  const response = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: ghlHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify(payload)
  });

  const data = await safeJson(response);

  if (!response.ok) {
    console.error("Update contact failed:", data);
    throw new Error(`Failed to update contact ${contactId}: ${response.status}`);
  }

  return data;
}

// -----------------------------------
// DEMO HELPERS
// -----------------------------------
function buildPreviewUrl(website) {
  if (!website) return "";

  const target = website.startsWith("http://") || website.startsWith("https://")
    ? website
    : `https://${website}`;

  return `https://api.microlink.io/?url=${encodeURIComponent(target)}&screenshot=true&fullPage=true&viewport.width=390&viewport.height=844&viewport.deviceScaleFactor=1&meta=false&embed=screenshot.url&isMobile=true`;
}

function buildDemoSummary({ company, service, website, city }) {
  const parts = [];

  if (company) parts.push(`Business name: ${company}.`);
  if (service) parts.push(`Primary service: ${service}.`);
  if (website) parts.push(`Website: ${website}.`);
  if (city) parts.push(`Likely city or service area: ${city}.`);

  parts.push("This is a live demo lead.");
  parts.push("Speak naturally, warmly, and confidently.");
  parts.push("Reference the business name and service when helpful.");
  parts.push("Do not invent website details that were not explicitly provided.");

  return parts.join(" ");
}

async function safeJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

// -----------------------------------
// START SERVER
// -----------------------------------
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
