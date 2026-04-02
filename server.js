
const express = require("express");
const cors = require("cors");
require("dotenv").config();

console.log("OPENAI KEY:", process.env.OPENAI_API_KEY ? "LOADED" : "MISSING");

const app = express();

app.use(cors({
  origin: ["https://speedireply.co"]
}));
app.use(express.json());

// ===============================
// ENV
// ===============================
const PORT = process.env.PORT || 3000;
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_API_BASE = "https://services.leadconnectorhq.com";

console.log("API KEY LOADED:", GHL_API_KEY ? "YES" : "NO");

const puppeteer = require("puppeteer");
const crypto = require("crypto");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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
  locationId: process.env.GHL_LOCATION_ID, // 🔥 REQUIRED

  firstName: data.firstName || "Guest",
  lastName: data.lastName || "Visitor",
  phone: data.phone,
  email: data.email,
  companyName: data.company,
  Website: data.website,

  customFields: [
    	{ key: "business_service", field_value: data.service },
    	{ key: "sr_session_id", field_value: data.sessionId }
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

  //ADDED THIS on 3-31-26
  if (data.customFieldsExtra && Array.isArray(data.customFieldsExtra)) {
      customFields.push(...data.customFieldsExtra);
  }

  if (data.service)
  customFields.push({ key: "business_service", field_value: data.service });

  //if (data.website)
  //customFields.push({ key: "business_url", field_value: data.website });

  if (data.city)
  customFields.push({ key: "city", field_value: data.city });

  if (data.sessionId)
  customFields.push({ key: "sr_session_id", field_value: data.sessionId });

  if (data.summary)
  customFields.push({ key: "sr_demo_summary", field_value: data.summary });

  if (data.previewUrl)
  customFields.push({ key: "sr_preview_url", field_value: data.previewUrl });

  const payload = {
  	//locationId: process.env.GHL_LOCATION_ID, // 🔥 REQUIRED

  	firstName: data.firstName,
  	email: data.email,
  	phone: data.phone,
  	companyName: data.company,
        website: data.website,
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


// ===============================================
//    ADDED BELOW FOR DEMO LINK & WEBSITE SCRAPER
// ===============================================



// ===============================
// CREATE DEMO LINK (NEW)
// ===============================
app.post("/create-demo", async (req, res) => {
  
  const startTime = Date.now(); // ⏱️ start timer
  let companySafe = "";
  let contactIdSafe = "";
  try {
    const {
      contact_id,
      first_name,
      last_name,
      email,
      phone,
      company_name,
      website
    } = req.body || {};

    const companySafe = company_name || "Unknown Company";
    const contactIdSafe = contact_id || "Unknown ID";

    if (!contact_id) {
      return res.status(400).json({ ok: false, error: "Missing contact_id" });
    }

    let site = website || "";
    if (!site.startsWith("http")) {
      site = `https://${site}`;
    }

    console.log("🚀 Creating demo for:", companySafe);

    // ===============================
    // 1. SCRAPE WEBSITE (PUPPETEER)
    // ===============================
    console.log("🌐 Scraping website...");
    
    const puppeteer = require("puppeteer");

    const browser = await puppeteer.launch({
       headless: true,
       executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
       args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    await page.goto(site, {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    const text = await page.evaluate(() => {
      const remove = ["script", "style", "noscript"];
      remove.forEach(tag => {
        document.querySelectorAll(tag).forEach(el => el.remove());
      });

      return document.body.innerText
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 6000);
    });

    await browser.close();

    // ===============================
    // 2. AI SUMMARY
    // ===============================

    console.log("🧠 Generating AI summary...");

    let summary = "Website scanned. AI will respond naturally.";

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Summarize this business for an AI receptionist.

Include:
- Services
- Location if available
- What they do

Keep it short and conversational.
`
          },
          { role: "user", content: text }
        ]
      });

      summary = completion.choices[0].message.content;
    } catch (err) {
          console.log("⚠️ AI summary failed:", err.message, err.stack);
      }

    // ===============================
    // 3. TOKEN
    // ===============================
    console.log("🔑 Creating token...");
    
    const token = crypto.randomUUID();

    // ===============================
    // 4. DEMO URL
    // ===============================
    const demoUrl = `${process.env.BASE_DEMO_URL}?t=${token}&c=${contact_id}`;

    // ===============================
    // 5. SAVE TO GHL (REUSE YOUR FUNCTION)
    // ===============================
    
    console.log("💾 Saving to GHL...");

    await updateContact(contact_id, {
       summary,
       previewUrl: demoUrl,
       customFieldsExtra: [
        { key: "sr_demo_token", field_value: token },
        { key: "sr_website_summary", field_value: summary },
        { key: "sr_demo_url", field_value: demoUrl }
       ]
     });

    const duration = Date.now() - startTime;

    console.log("✅ DEMO CREATED:", {
      company: companySafe,
      contact_id,
      demoUrl,
      duration_ms: duration
    });

    res.json({
      ok: true,
      token,
      demoUrl
    });

  } catch (err) {
      const duration = Date.now() - startTime;

      console.error("❌ DEMO FAILED:", {
         company: companySafe,
         contact_id: contactIdSafe,
         error: err.message,
         duration_ms: duration
      });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===============================
// GET DEMO DATA (TOKEN + CONTACT ID)
// ===============================
app.get("/demo-data", async (req, res) => {
  try {
    const token = req.query.t;
    const contactId = req.query.c;

    if (!token || !contactId) {
      return res.status(400).json({
        ok: false,
        error: "Missing token or contactId"
      });
    }

    console.log("🔍 Fetching contact:", contactId);
    console.log("🔑 Validating token:", token);
    

    // 🔥 GET CONTACT DIRECTLY (NO SEARCH)
    const response = await fetch(
      `${GHL_API_BASE}/contacts/${contactId}`,
      {
        method: "GET",
        headers: ghlHeaders({
          "Location-Id": process.env.GHL_LOCATION_ID
        })
      }
    );

    const json = await response.json();

    if (!response.ok) {
      console.error("❌ Contact fetch failed:", json);
      return res.status(404).json({
        ok: false,
        error: "Contact not found"
      });
    }

    const contact = json.contact;

    // 🔥 HELPER TO GET CUSTOM FIELD
    const FIELD_IDS = {
         DEMO_TOKEN: "smKTeeLWqyEi9xG6DEeS", // 🔥 your actual sr_demo_token ID
         WEBSITE_SUMMARY: "8QiNdg40mEbc0h8qhZ7s",  // 🔥 your actual sr_demo_summary ID
         DEMO_URL: "HkGDkNl78aMTFpmB7t6t"  // 🔥 your actual sr_demo_url ID
     };

    const getFieldById = (id) => {
        const field = contact.customFields?.find(f => f.id === id);
        return field ? field.value : null;
    };

    const storedToken = getFieldById(FIELD_IDS.DEMO_TOKEN);

    console.log("🔍 Stored token:", storedToken);
    console.log("🔍 Incoming token:", token);
    console.log("🔍 Token match result:", storedToken === token);

    // 🔥 VALIDATE TOKEN MATCHES CONTACT
    if (!storedToken || storedToken.trim() !== token.trim()) {
      console.warn("❌ Token mismatch:", {
        expected: storedToken,
        received: token
      });

      return res.status(403).json({
        ok: false,
        error: "Invalid token"
      });
    }

    console.log("✅ Token validated for:", contact.companyName);

    // 🔥 BUILD RESPONSE DATA
    const data = {
      contact_id: contact.id,
      first_name: contact.firstName,
      last_name: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      website: contact.website,
      company_name: contact.companyName,
      //website: getField("business_url"),
      summary: getFieldById(FIELD_IDS.WEBSITE_SUMMARY),
      demo_url: getFieldById(FIELD_IDS.DEMO_URL)
    };

    console.log("✅ Demo data ready:", contact.companyName);
    console.log("Website = ", contact.website);

    res.json({
      ok: true,
      data
    });

  } catch (err) {
    console.error("❌ DEMO DATA ERROR:", err);

    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});