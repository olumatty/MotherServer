const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const OpenAI = require('openai')
const Prompt = require('./prompt')
const { default: axios } = require('axios')
const { Sessions } = require('openai/resources/beta/realtime/sessions.mjs')

dotenv.config()

const app = express();
const PORT = 8000;

app.use(express.json())
app.use(cors())

const client = new OpenAI({apiKey:process.env.OPENAI_API_KEY});

const sessions = {};

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
        endpoint:"http://localhost:8003/sight_seeeing"
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
                        description: "The location or airport where the flight is departing from (e.g., BOM, DEL,NYK).airport"
                    },
                    destination: {
                        type: "string",
                        description: "The destination city or airport (e.g., London).airport",
                    },
                    departure_date: {
                        type: "string",
                        format: "date",
                        description: "The date of departure in YYYY-MM-DD format"
                    },
                    flight_type: {
                        type: "string",
                        enum: ["Economy", "business-class"],
                        description: "The type of flight: one-way or round-trip"
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

        const response = await axios.post(agent.endpoint, parameters);

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

                const functionResult = await callAgentApi(functionName, functionArgs);
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
                messages: finalMessages
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

