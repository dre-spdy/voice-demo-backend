
express = require("express")
const cors = require("cors")
const fetch = require("node-fetch")
require("dotenv").config()

const app = express()

app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 3000;


/* =========================
   HELPERS
========================= */

// 🔥 Normalize phone to E.164 (+1XXXXXXXXXX)
function normalizePhone(phone) {
  if (!phone) return null;

  let digits = phone.replace(/\D/g, "");

  // Assume US if 10 digits
  if (digits.length === 10) {
    digits = "1" + digits;
  }

  if (!digits.startsWith("1")) {
    return "+" + digits;
  }

  return "+" + digits;
}


/* =========================
   HEALTH CHECK
========================= */

app.get("/", (req,res)=>{
  res.json({status:"backend running"})
})

/* =========================
   CREATE / UPDATE CONTACT (SMART + URL CONTACTID)
========================= */

app.post("/create-contact", async (req, res) => {
  try {

    let {
      contactId,
      companyName,
      firstName,
      lastName,
      email,
      phone,
      service
    } = req.body;

    console.log("📥 Incoming:", req.body);

    // 🔥 Normalize phone
    phone = normalizePhone(phone);

    // 🔥 Require at least one identifier
    if (!email && !phone && !contactId) {
      return res.status(400).json({
        error: "Email, phone, or contactId is required"
      });
    }

    let idToUse = contactId || null;

    /* =========================
       STEP 1: SEARCH (if no contactId)
    ========================= */

    if (!idToUse) {
      try {
        let searchUrl = null;

        if (phone) {
          searchUrl = `https://services.leadconnectorhq.com/contacts/search?phone=${encodeURIComponent(phone)}`;
        } else if (email) {
          searchUrl = `https://services.leadconnectorhq.com/contacts/search?email=${encodeURIComponent(email)}`;
        }

        if (searchUrl) {
          const searchRes = await fetch(searchUrl, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${process.env.GHL_API_KEY}`,
              Version: "2021-07-28"
            }
          });

          const searchData = await searchRes.json();

          if (searchData.contacts && searchData.contacts.length > 0) {
            idToUse = searchData.contacts[0].id;
            console.log("🔁 Found existing contact:", idToUse);
          }
        }

      } catch (err) {
        console.warn("⚠️ Search failed, continuing:", err.message);
      }
    }

    /* =========================
       STEP 2: DETERMINE METHOD
    ========================= */

    let url;
    let method;

    if (idToUse) {
      url = `https://services.leadconnectorhq.com/contacts/${idToUse}`;
      method = "PUT";
      console.log("🔁 Updating contact:", idToUse);
    } else {
      url = `https://services.leadconnectorhq.com/contacts/`;
      method = "POST";
      console.log("🆕 Creating new contact");
    }


/* =========================
       STEP 3: BUILD BODY
    ========================= */

    let body;

    if (method === "POST") {
      // ✅ CREATE (include locationId)
      body = {
        locationId: process.env.GHL_LOCATION_ID,
        firstName,
        lastName,
        email: email || undefined,
        phone: phone || undefined,
        companyName,
        customFields: [
          {
            id: "ZupChSuIotB55kMGxZiD",
            field_value: service || ""
          }
        ]
      };
    } else {
      // ✅ UPDATE (NO locationId)
      body = {
        firstName,
        lastName,
        email: email || undefined,
        phone: phone || undefined,
        companyName,
        customFields: [
          {
            id: "ZupChSuIotB55kMGxZiD",
            field_value: service || ""
          }
        ]
      };
    }

    console.log("📡 METHOD:", method);
    console.log("📡 BODY:", body);

    /* =========================
       STEP 4: SEND TO GHL
    ========================= */

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        "Content-Type": "application/json",
        Version: "2021-07-28"
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    console.log("📡 GHL Response:", data);

    if (!response.ok) {
      return res.status(response.status).json({
        error: "GHL error",
        ghl: data
      });
    }

    /* =========================
       STEP 5: EXTRACT CONTACT ID
    ========================= */

    const finalContactId =
      data.contact?.id ||
      data.id ||
      idToUse;

    if (!finalContactId) {
      return res.status(500).json({
        error: "No contactId returned",
        ghl: data
      });
    }

    console.log("✅ Final contactId:", finalContactId);

    /* =========================
       SUCCESS RESPONSE
    ========================= */

    res.json({
      success: true,
      contactId: finalContactId,
      companyName,
      phone,
      email
    });

  } catch (error) {
    console.error("❌ Server Error:", error);

    res.status(500).json({
      error: "Server crashed",
      details: error.message
    });
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
