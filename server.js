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

app.post("/update-contact", async (req,res)=>{

  try{

    const { contactId, companyName, firstName, lastName, service } = req.body

    const response = await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      {
        method:"PUT",
        headers:{
          Authorization:`Bearer ${process.env.GHL_API_KEY}`,
          "Content-Type":"application/json",
          Version:"2021-07-28"
        },
        body: JSON.stringify({
  		companyName,
  		firstName,
  		lastName,
  		customFields: [
    			{
      			id: "ZupChSuIotB55kMGxZiD",
      			field_value: service
    			}
  		]
	})
      }
    )

    const data = await response.json()

    res.json({
      success:true,
      ghl:data
    })

  }catch(error){

    res.status(500).json({
      error:error.message
    })

  }

})

app.listen(PORT, ()=>{
  console.log(`Server running on port ${PORT}`)
})