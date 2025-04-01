const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const OpenAI = require('openai')
const Prompt = require('./prompt')

dotenv.config()

const app = express();
const PORT = 8000;

app.use(express.json())
app.use(cors())

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const tools = [{
    type:"function",
    name: "get_flight_Information",
    description:"Get flight information based on user input",
    parameters:{
        type:"object",
        properties:{
            departure_location:{
                type:"string",
                description: "The location where the flight is departing from (e.g., Lagos)"
            },
            destination:{
                type:"string",
                description: "The destination city or airport (e.g., London)",
            },
            departure_date:{
                type:"string",
                format:"date",
                description: "The date of departure in YYYY-MM-DD format"
            },
            flight_type:{
                type:"string",
                enum: ["one-way", "round-trip"],
                description: "The type of flight: one-way or round-trip"
            },
            number_of_passengers:{
                type:"integer",
                description:"The number of passengers for the flight"
            }
        },
        required:["departure_location", "destination", "departure_date", "flight_type", "number_of_passengers"],
        additionalProperties:false
    },
    strict:true
},

{
    type:"function",
    name:"get_accomodation",
    description:"Helps with list of accomodations at user destination location",
    parameters:{
        type:"object",
        properties:{
            destination:{
                type:"string",
            }
        },
        required:["destination"],
        additionalProperties:false
    }
},

{
    type:"function",
    name:"get_sightSeeing",
    description:"Helps with sight-seeing recommendation based on user destination location",
    parameters:{
        type:"object",
        properties:{
            destination:{
                type:"string",
            }
        },
        required:['destination'],
        additionalProperties:false
    }

}

]

app.post("/mother-api", async (req,res) => {
    const userMessage = req.body;

    const completion = await client.chat.completions.create({
        model:"gpt-4-turbo",
        messages:[
            {
                role:"system",
                content:Prompt
            },
            {
                ...userMessage
            }
        ],
        tools:tools,
        tool_choice:"auto",
    })

    const reply = completion.choices[0]?.message?.content;
    res.status(200).json({ reply });
});

app.listen(PORT, () =>{
    console.log(`The server is running on port ${PORT}`);
})
