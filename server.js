const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const OpenAI = require('openai')
const Prompt = require('./prompt')
const { default: axios } = require('axios')

dotenv.config()

const app = express();
const PORT = 8000;

app.use(express.json())
app.use(cors())

const client = new OpenAI({apiKey:process.env.OPENAI_API_KEY});

const AGENTS = {
    get_flight_information:{
        name:"Alice (Flight Agent)",
        endpoint:""
    },
    get_accomodation:{
        name:"Bob (Accomodation Agent)",
        endpoint:""
    },
    get_sightSeeing:{
        name:"Charlie (Sightseeing Agent)",
        endpoint:""
    }
} 

const tools = [{
    type:"function",
    name: "get_flight_information",
    description:"Get flight information from Alice (Flight Agent) based on user input",
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
            },
        },
        required:["departure_location", "destination", "departure_date", "flight_type", "number_of_passengers"],
        additionalProperties:false
    },
    strict:true
},

{
    type:"function",
    name:"get_accomodation",
    description:"Get accommodation options from Bob (Accommodation Agent) at user destination location",
    parameters:{
        type:"object",
        properties:{
            destination:{
                type:"string",
                description: "The destination city or location for accommodation",
            }
        },
        required:["destination"],
        additionalProperties:false
    }
},

{
    type:"function",
    name:"get_sightSeeing",
    description:"Get sightseeing recommendations from Charlie (Sightseeing Agent) based on user destination location",
    parameters:{
        type:"object",
        properties:{
            destination:{
                type:"string",
                description:"The destination city or location for sightseeing recommendations",
            },
        },
        required:['destination'],
        additionalProperties:false
    }
}
]

async function callAgentApi (toolName, parameters){
    try{
        const agent = AGENTS[toolName]

        if(!agent){
            throw new Error (`No agent defined for tool :${toolName}`)
        }
        console.log(`Calling ${agent.name} for information...`);

        const response = await axios.post(agent.endpoint, parameters);

        return {
            agent:agent.name,
            ...response.data
        }
    }catch(error){
        console.error(`Error calling ${AGENTS[toolName]?.name || toolName}, API:`, error.message)
        return{
            agent:AGENTS[toolName]?.name || toolName,
            error:`Failed to get data from ${AGENTS[toolName]?.name || toolName}`,
            message:error.message
        }
    }
}

app.post("/mother", async (req,res) => {
    try{
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

    let reply = completion.choices[0]?.message?.content;
    let toolResults=[]

    if(reply.tool_calls && assistantResponse.tool_calls.length > 0){
        for (const toolCall of reply.tool_calls){
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments);
            const agentName = AGENTS[toolName]?.name || toolName;

            console.log(`Calling ${agentName} with args:`, functionArgs)

            const functionResult = await callAgentApi(functionName, functionArgs)
            toolResults.push({   
                agent: agentName,
                toolCall:toolCall,
                result: functionResult
        });


        messages.push(reply)
        message.push({
            role:"tool",
            tool_call_id:toolCall.id,
            name:functionName,
            content:JSON.stringify(functionResult)
        })
        }

        const response2 = await openai.responses.create({
            model:"gpt-4-turbo",
            messages:messages
        });

        reply = secondCompletion.choices[0].message;
    } 

    res.send (200).json({
        reply,
        toolResults: toolResults.length > 0 ? toolResults : undefined 
    });
}catch(error){
    console.error("Error:", error);
    res.status(500).json({error: "An error occurred while processing your request", details: error.message})
}

});

app.listen(PORT, () =>{
    console.log(`The server is running on port ${PORT}`);
})
