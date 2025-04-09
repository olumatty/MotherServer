const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const OpenAI = require('openai')
const Prompt = require('./prompt')
const { default: axios } = require('axios')
const getIataCodeFromCity = require('./util/iata')
const {isRatedLimit, setupIpTracking} = require('./middleware/ratelimit')

dotenv.config()

const app = express();
const PORT = 8000;

app.use(express.json())
app.use(cors())

const client = new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const temperature = parseFloat(process.env.API_TEMPERATURE)||0.7;

//Define Agents
const AGENTS = {
    get_flight_information:{
        name:"Alice (Flight Agent)",
        endpoint:"http://localhost:8001/get-flight-prices"
    },
    get_accomodation:{
        name:"Bob (Accomodation Agent)",
        endpoint:"http://localhost:8002/get_accommodation"
    },
    get_sightSeeing:{
        name:"Charlie (Sightseeing Agent)",
        endpoint:"http://localhost:8003/sight_seeing"
    }
} 

// Correctly formatted tools for OpenAI API
const tools = [
    {
        type: "function",
        function: {
            name: "get_flight_information",
            description: "Get flight information from Alice (Flight Agent) based on user input",
            parameters: {
                type: "object",
                properties: {
                    departure_location: {
                        type: "string",
                        description: "The location or airport where the flight is departing from (e.g. BOM, DEL, LOS, DXB, NYK).airport"
                    },
                    destination: {
                        type: "string",
                        description: "The destination city or airport (e.g. BOM, DEL, LOS, DXB, NYK ).airport",
                    },
                    departure_date: {
                        type: "string",
                        format: "date",
                        description: "The date of departure in YYYY-MM-DD format"
                    },
                    flight_type: {
                        type: "string",
                        enum: ["Economy", "business-class"],
                        description: "The type of flight: (Economy, business-class or first-class)"
                    },
                    number_of_passengers: {
                        type: "integer",
                        description: "The number of passengers for the flight"
                    },
                },
                required: ["departure_location", "destination", "departure_date", "flight_type", "number_of_passengers"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_accomodation",
            description: "Get accommodation options from Bob (Accommodation Agent) at user destination location",
            parameters: {
                type: "object",
                properties: {
                    destination: {
                        type: "string",
                        description: "The destination city or location for accommodation",
                    }
                },
                required: ["destination"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_sightSeeing",
            description: "Get sightseeing recommendations from Charlie (Sightseeing Agent) based on user destination location",
            parameters: {
                type: "object",
                properties: {
                    destination: {
                        type: "string",
                        description: "The destination city or location for sightseeing recommendations",
                    },
                },
                required: ['destination'],
                additionalProperties: false
            }
        }
    }
];

//Calls the Agents API AND Parameters
async function callAgentApi(toolName, parameters){
    try{
        const agent = AGENTS[toolName]

        if(!agent){
            throw new Error(`No agent defined for tool: ${toolName}`)
        }
        console.log(`Calling ${agent.name} for information...`);

        let response;

    
        if (toolName === "get_accomodation" || toolName === "get_sightSeeing") {
            response = await axios.get(agent.endpoint, {
                params: parameters
            });
        } else {
            response = await axios.post(agent.endpoint, parameters);
        }

        return {
            agent: agent.name,
            ...response.data
        }
    } catch(error) {
        console.error(`Error calling ${AGENTS[toolName]?.name || toolName} API:`, error.message)
        return{
            agent: AGENTS[toolName]?.name || toolName,
            error: `Failed to get data from ${AGENTS[toolName]?.name || toolName}`,
            message: error.message
        }
    }
}

//Handles the AI Processing
app.post("/mother", async (req,res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local';

    if(isRatedLimit(ip)){
        return res.status(429).json({error:"Too many requests, try again after 1 hour"});
    }

    setupIpTracking(ip);

    try{
        // Get messages from request body
        const  {messages} = req.body;
        
        // Validate messages
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Messages must be a non-empty array" });
        }
        
        // Ensure all messages have roles
        const validMessages = messages.map(msg => {
            if (!msg.role) {
                return { ...msg, role: "user" };
            }
            return msg;
        });

        // Add system prompt as the first message
        const systemMessage = {
            role: "system",
            content: Prompt,
            
        };
        
        // Create final messages array with system prompt first
        const finalMessages = [systemMessage, ...validMessages];

        const completion = await client.chat.completions.create({
            model: "gpt-4-turbo",
            messages: finalMessages,
            temperature: temperature,
            tools: tools,
            tool_choice: "auto",
        });

        let assistantMessage = completion.choices[0].message;
        let reply = assistantMessage.content;
        let toolResults = [];

        // Handle tool calls if they exist
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            // Add the assistant's message to the conversation
            finalMessages.push(assistantMessage);
            
            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);
                const agentName = AGENTS[functionName]?.name || functionName;
            
                console.log(`Calling ${agentName} with args:`, functionArgs);
            
                // Convert IATA codes if needed
                if(functionName === 'get_flight_information'){
                    if(functionArgs.departure_location && functionArgs.departure_location.length !== 3){
                        const iata = getIataCodeFromCity(functionArgs.departure_location);
                        if(iata){
                            functionArgs.departure_location = iata;
                            console.log(`Converted ${functionArgs.departure_location} to IATA code: ${iata}`);
                        }
                    }
                    if(functionArgs.destination && functionArgs.destination.length !== 3){
                        const iata = getIataCodeFromCity(functionArgs.destination);
                        if(iata){
                            functionArgs.destination = iata;
                            console.log(`Converted ${functionArgs.destination} to IATA code: ${iata}`);
                        }
                    }

                    // Create properly formatted parameters for the flight API
                    let apiParams = {
                        originLocationCode: functionArgs.departure_location,
                        destinationLocationCode: functionArgs.destination,
                        departureDate: functionArgs.departure_date,
                        adults: functionArgs.number_of_passengers,
                        travelClass: functionArgs.flight_type === 'BUSINESS-CLASS' ? 'BUSINESS' : 'ECONOMY'
                    };

                    var functionResult = await callAgentApi(functionName, apiParams);
                } else {
                    // For other tools, use the original parameters
                    var functionResult = await callAgentApi(functionName, functionArgs);
                }

            
                toolResults.push({   
                    agent: agentName,
                    toolCall: toolCall,
                    result: functionResult
                });
            
                // Add the tool response to the conversation
                finalMessages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: functionName,
                    content: JSON.stringify(functionResult)
                });
            }
        
            // Get a second response from the model with the tool results
            const response2 = await client.chat.completions.create({
                model: "gpt-4-turbo",
                messages: finalMessages,
                temperature: temperature
            });
        
            reply = response2.choices[0].message.content;
        }

        res.status(200).json({
            reply,
            toolResults: toolResults.length > 0 ? toolResults : undefined 
        });
    } catch(error) {
        console.error("Error:", error);
        res.status(500).json({error: "An error occurred while processing your request", details: error.message});
    }
});

app.listen(PORT, () => {
    console.log(`The server is running on port ${PORT}`);
});

