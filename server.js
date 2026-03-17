const express = require("express")
const cors = require("cors")
const fetch = require("node-fetch")
require("dotenv").config()

const app = express()

app.use(cors())
app.use(express.json())

const PORT = process.env.PORT

app.get("/", (req,res)=>{
  res.json({status:"backend running"})
})


app.post("/update-contact", async (req, res) => {
  try {

    const { contactId, companyName, firstName, lastName, email, service } = req.body;

    // 🔥 REQUIRE EMAIL
    if (!email) {
      return res.status(400).json({
        error: "Email is required"
      });
    }

    let url;
    let method;

    if (contactId) {
      // ✅ UPDATE existing contact
      url = `https://services.leadconnectorhq.com/contacts/${contactId}`;
      method = "PUT";
      console.log("Updating contact:", contactId);
    } else {
      // ✅ CREATE new contact
      url = `https://services.leadconnectorhq.com/contacts/`;
      method = "POST";
      console.log("Creating new contact");
    }

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        "Content-Type": "application/json",
        Version: "2021-07-28"
      },
      body: JSON.stringify({
        firstName,
        lastName,
        email,            // ✅ REQUIRED
        companyName,
        customFields: [
          {
            id: "ZupChSuIotB55kMGxZiD", // ✅ correct usage (ID, not key)
            field_value: service
          }
        ]
      })
    });

    const data = await response.json();

    console.log("GHL RESPONSE:", data);

    if (!data.contact || !data.contact.id) {
      return res.status(500).json({
        error: "Failed to create/update contact",
        ghl: data
      });
    }

    res.json({
      success: true,
      contactId: data.contact.id
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});


app.listen(PORT, ()=>{
  console.log(`Server running on port ${PORT}`)
})