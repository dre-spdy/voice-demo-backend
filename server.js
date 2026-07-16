const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

console.log("OPENAI KEY:", process.env.OPENAI_API_KEY ? "LOADED" : "MISSING");

const app = express();

// 🔥 SERVE FRONTEND FILES FIRST
app.use(express.static(path.join(__dirname, "public")));

// 🔥 THEN middleware
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
// PUPPETEER CONCURRENCY CONTROL
// ===============================
let activePuppeteerJobs = 0;
const MAX_CONCURRENT_PUPPETEER_JOBS = 1;
const puppeteerQueue = [];

function acquirePuppeteerSlot() {
  return new Promise((resolve) => {
    if (activePuppeteerJobs < MAX_CONCURRENT_PUPPETEER_JOBS) {
      activePuppeteerJobs++;
      console.log(`🔒 Puppeteer slot acquired. Active jobs: ${activePuppeteerJobs}`);
      resolve();
      return;
    }

    console.log(`⏳ Puppeteer busy. Request added to queue. Queue length: ${puppeteerQueue.length + 1}`);
    puppeteerQueue.push(resolve);
  });
}

function releasePuppeteerSlot() {
  activePuppeteerJobs = Math.max(0, activePuppeteerJobs - 1);
  console.log(`🔓 Puppeteer slot released. Active jobs: ${activePuppeteerJobs}`);

  const nextJob = puppeteerQueue.shift();
  if (nextJob) {
    activePuppeteerJobs++;
    console.log(`▶️ Starting next queued Puppeteer job. Remaining queue: ${puppeteerQueue.length}`);
    nextJob();
  }
}

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

  // ===============================
  // TAG HANDLING
  // ===============================
  const tagsToAdd = data.tagsToAdd || [];
  let updatedTags = [];
  if (tagsToAdd.length > 0) {
     try {
       const contactRes = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
         method: "GET",
         headers: ghlHeaders()
       });

       const contactJson = await contactRes.json();
       const existingTags = contactJson.contact?.tags || [];

       updatedTags = [...new Set([...existingTags, ...tagsToAdd])];

     } catch (err) {
       console.error("⚠️ Failed to fetch existing tags:", err.message);
     }
   }

  // ===============================
  // PAYLOAD
  // ===============================
  const payload = {
  	//locationId: process.env.GHL_LOCATION_ID, // 🔥 REQUIRED

  	firstName: data.firstName,
  	email: data.email,
  	phone: data.phone,
  	companyName: data.company,
        website: data.website,
  	customFields,
        ...(updatedTags.length > 0 && { tags: updatedTags }) // ✅ ADD THIS LINE
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

app.listen(process.env.PORT || 3000, () => {
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
  let puppeteerSlotAcquired = false;

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

    /*const companySafe = company_name || "Unknown Company";
    const contactIdSafe = contact_id || "Unknown ID"; */
    
    companySafe = company_name || "Unknown Company";
    contactIdSafe = contact_id || "Unknown ID";

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
    console.log("🌐 Waiting for Puppeteer slot...");

    await acquirePuppeteerSlot();
    puppeteerSlotAcquired = true;

    console.log("🌐 Scraping website...starting puppeteer");
    console.log("Puppeteer executable:", puppeteer.executablePath());

    let browser;
    let text = "";

    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: puppeteer.executablePath(),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu"
        ],
        timeout: 60000,
        dumpio: true
      });

      const page = await browser.newPage();

      await page.setRequestInterception(true);

      page.on("request", request => {
        const resourceType = request.resourceType();

        if (["image", "media", "font"].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      page.setDefaultNavigationTimeout(45000);

      const response = await page.goto(site, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });

      if (!response) {
        throw new Error(`Website returned no navigation response: ${site}`);
      }

      console.log("Website response status:", response.status());
      console.log("Final website URL:", page.url());

      await new Promise(resolve => setTimeout(resolve, 2000));

      text = await page.evaluate(() => {
        const remove = ["script", "style", "noscript", "svg"];

        remove.forEach(tag => {
          document.querySelectorAll(tag).forEach(el => el.remove());
        });

        return document.body?.innerText
          ?.replace(/\s+/g, " ")
          .trim()
          .slice(0, 6000) || "";
      });

      if (!text) {
        throw new Error(`No readable website text found at ${page.url()}`);
      }

      console.log(`✅ Website scraped: ${text.length} characters`);

    } finally {
      if (browser) {
        try {
          await browser.close();
          console.log("✅ Puppeteer browser closed");
        } catch (browserCloseError) {
          console.error("⚠️ Failed to close Puppeteer browser:", browserCloseError.message);
        }
      }

      if (puppeteerSlotAcquired) {
        releasePuppeteerSlot();
        puppeteerSlotAcquired = false;
      }
    }

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

    const { nanoid } = require("nanoid");

    let token;
    let attempts = 0;
    const MAX_ATTEMPTS = 3;

    do {
      token = nanoid(8);
      attempts++;
    } while ((!token || token.length < 6) && attempts < MAX_ATTEMPTS);

    if (!token || token.length < 6) {
      throw new Error("Failed to generate valid token after retries");
    }

    console.log("🔑 Token created:", token);
	
	
    // ===============================
    // 4. DEMO URL
    // ===============================
    const demoUrl = `${process.env.BASE_DEMO_URL}/demo?t=${token}`;

    // ===============================
    // 5. SAVE TO GHL (REUSE YOUR FUNCTION)
    // ===============================
    
    console.log("💾 Saving to GHL...");

    await updateContact(contact_id, {
       summary,
       previewUrl: demoUrl,
       tagsToAdd: ["Demo Created"],   // ✅ THIS NOW WORKS
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

    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: err.message });
    }
  } finally {
    // Safety net in case an error occurs after acquiring the slot
    // but before the scraper's inner finally releases it.
    if (puppeteerSlotAcquired) {
      releasePuppeteerSlot();
      puppeteerSlotAcquired = false;
    }
  }
});

// ===============================
// GET DEMO DATA (TOKEN + CONTACT ID)
// ===============================
app.get("/demo-data", async (req, res) => {
  try {
    const token = req.query.token || req.query.t;

    if (!token) {
      return res.status(400).json({
        ok: false,
        error: "Missing token or contactId"
      });
    }
    // 🔥 HELPER TO GET CUSTOM FIELD
    const FIELD_IDS = {
         DEMO_TOKEN: "smKTeeLWqyEi9xG6DEeS", // 🔥 your actual sr_demo_token ID
         WEBSITE_SUMMARY: "8QiNdg40mEbc0h8qhZ7s",  // 🔥 your actual sr_demo_summary ID
         DEMO_URL: "HkGDkNl78aMTFpmB7t6t",  // 🔥 your actual sr_demo_url ID
         DEMO_AGENT_TYPE: "u6PUIjkcnObn73tWNyWR"   // actual sr_demo_agent_type
     };

    console.log("🔍 Searching contact by token received:", token);

    const response = await fetch(
      `${GHL_API_BASE}/contacts/search`,
      {
        method: "POST",
        headers: ghlHeaders({
          "Location-Id": process.env.GHL_LOCATION_ID
        }),
        body: JSON.stringify({
          locationId: process.env.GHL_LOCATION_ID,
          page: 1,
          pageLimit: 1,
          filters: [
            {
              field: `customFields.${FIELD_IDS.DEMO_TOKEN}`,
              operator: "eq",
              value: token.trim()
            }
           ]
         })
      }
    );

    const json = await response.json();

    if (!response.ok || !json.contacts || json.contacts.length === 0) {
      console.error("❌ Contact not found:", json);

      return res.status(404).json({
        ok: false,
        error: "Demo not found"
      });
    }

    const contact = json.contacts[0];

    /***** USED TO GET THE CUSTOM FIELD ID ******
    console.log(
      "🔥 ALL CUSTOM FIELDS:",
        JSON.stringify(contact.customFields, null, 2)
    );
    ************** */
    

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

    //******************************* 
    //    TRACKING OPEN DATE & TIME 
    //*******************************
    const alreadyOpened = contact.customFields?.find(
      f => f.key === "sr_demo_opened_at"
    );

    if (!alreadyOpened?.value) {
        await fetch(`${GHL_API_BASE}/contacts/${contact.id}`, {
        method: "PUT",
        headers: ghlHeaders(),
        body: JSON.stringify({
          customFields: [
            {
              key: "sr_demo_opened_at",
              field_value: new Date().toISOString()
            }
          ],
          tags: ["demo_opened"]
        })
      });
    }
    

    // 🔥 BUILD RESPONSE DATA
    const demoUrl = getFieldById(FIELD_IDS.DEMO_URL);

    const data = {
      contact_id: contact.id,
      first_name: contact.firstName,
      last_name: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      website: contact.website,
      company_name: contact.companyName,
      summary: getFieldById(FIELD_IDS.WEBSITE_SUMMARY),
      demo_url: demoUrl,
      agent_type: getFieldById(FIELD_IDS.DEMO_AGENT_TYPE)
    };

    console.log("✅ Demo data ready:", contact.companyName);
    console.log("🌐 Website:", contact.website);
    console.log("🌍 Demo URL:", demoUrl);
    console.log(
        "🔥 Agent Type:",
        getFieldById(FIELD_IDS.DEMO_AGENT_TYPE)
    );

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


// ===============================
// FOR TRACKING IF DEMO IS ENGAGED
// ===============================

app.post("/demo-engaged", async (req, res) => {
  try {

    const { contactId } = req.body;

    if (!contactId) {
      return res.status(400).json({
        success: false,
        error: "Missing contactId"
      });
    }

    // ===============================
    // GET CURRENT CONTACT
    // ===============================

    const contactRes = await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.GHL_API_KEY}`,
          Version: "2021-07-28",
          "Content-Type": "application/json"
        }
      }
    );

    const contactData = await contactRes.json();

   // ===============================
    // FIND CURRENT COUNT
    // ===============================
    
    let currentCount = 0;
    
    const customFields =
      contactData.contact.customFields || [];
    
    /*console.log(
    //  "🔥 customFields:",
      JSON.stringify(customFields, null, 2)
    ); */
    
    const engagedField = customFields.find(
      f => f.id === "Z0hcbgKIso3SfrxlueOO"
    );
    
    //console.log("🔥 engagedField:", engagedField);
    
    if (engagedField) {
    
      currentCount = parseInt(
        engagedField.value || 0
      ) || 0;
    }
    
    //console.log("🔥 Demo currentCount:", currentCount);
    
    const newCount = currentCount + 1;
    
    //console.log("🔥 Demo engaged count:", newCount);

    // ===============================
    // UPDATE CONTACT
    // ===============================

    await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${process.env.GHL_API_KEY}`,
          Version: "2021-07-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          customFields: [
            {
              key: "sr_demo_engaged",
              field_value: true
            },
            {
              key: "sr_demo_engaged_count",
              field_value: newCount
            }
          ],
          tags: ["demo_engaged"]
        })
      }
    );

    res.json({
      success: true,
      engagedCount: newCount
    });

  } catch (err) {

    console.error("❌ demo-engaged error", err);

    res.status(500).json({
      success: false
    });

  }
});

