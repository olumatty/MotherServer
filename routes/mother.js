const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const { OpenAI } = require('openai');
const chatSession = require('../models/chatSession'); 
const {getIataCodeFromCity} = require('../util/iata');
const Prompt= require('../services/prompt');
const dotenv = require('dotenv');
const trackUserOrGuest = require('../middleware/trackUserOrGuest');

dotenv.config();

// Import your rate limiting functions
const { isRatedLimit, setupIpTracking } = require('../middleware/ratelimit');
 
// OpenAI client setup
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const temperature = parseFloat(process.env.API_TEMPERATURE) || 0.7;

// Define Agents
const AGENTS = {
    get_flight_information: {
        name: "Alice (Flight Agent)",
        endpoint: "http://localhost:8001/v1/get-flight-prices"
    },
    get_accomodation: {
        name: "Bob (Accomodation Agent)",
        endpoint: "http://localhost:8002/v1/get_accommodation"
    },
    get_sightSeeing: {
        name: "Charlie (Sightseeing Agent)",
        endpoint: "http://localhost:8003/v1/get_sight_seeing"
    }
};

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
                        description: "The date of departure inYYYY-MM-DD format"
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
            description: "Get accommodation options from Bob (Accommodation Agent) at user destination location, checkInDate and checkOutDate",
            parameters: {
                type: "object",
                properties: {
                    destination: {
                        type: "string",
                        description: "The destination city or location and the country for accommodation(e.g Lagos, Nigeria or London, UK)",
                    },
                    checkInDate: {
                        type: "string",
                        format: "date",
                        description: "The date of check-in inYYYY-MM-DD format"
                    },
                    checkOutDate: {
                        type: "string",
                        format: "date",
                        description: "The date of check-out inYYYY-MM-DD format"
                    }

                },
                required: ["destination", "checkInDate", "checkOutDate"],
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

function parseAndValidateDate(dateString) {
    const currentDate = moment();
    let parsedDate = moment(dateString, 'YYYY-MM-DD', true);

    if (!parsedDate.isValid()) {
        parsedDate = moment(dateString); 
        if (!parsedDate.isValid()) {
            return { error: `Could not parse date: ${dateString}. Please use YYYY-MM-DD format.` };
        }
    }

    if (parsedDate.isBefore(currentDate, 'day')) {
        console.warn(`Departure date "${dateString}" is in the past. Assuming current year (${currentDate.year()}).`);
        console.log(`Original date: ${dateString}, Parsed date: ${parsedDate.format('YYYY-MM-DD')}`);
        parsedDate.year(currentDate.year());
    }

    if (!parsedDate.isValid()) {
        return { error: `Invalid date after processing: ${dateString}.` };
    }

    return { date: parsedDate.format('YYYY-MM-DD') };
}

// Calls the Agents API AND Parameters
async function callAgentApi(toolName, parameters) {
    try {
        const agent = AGENTS[toolName];

        if (!agent) {
            throw new Error(`No agent defined for tool: ${toolName}`);
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

        if (response.status !== 200) {
            console.error(`Error from ${agent.name} API: Status ${response.status}`, response.data);
            return {
                agent: agent.name,
                error: `Failed to get data from ${agent.name}. API returned status: ${response.status}`,
                details: response.data
            };
        }

        return {
            agent: agent.name,
            ...response.data
        };
    } catch (error) {
        console.error(`Error calling ${AGENTS[toolName]?.name || toolName} API:`, error.message, error.response ? error.response.data : '');
        return {
            agent: AGENTS[toolName]?.name || toolName,
            error: `Failed to get data from ${AGENTS[toolName]?.name || toolName}`,
            message: error.message,
            details: error.response ? error.response.data : 'No details provided by the API.'
        };
    }
}

// Create the main endpoint for the mother API
router.post('/api/v1/mother',trackUserOrGuest,async (req, res) => {
    const sessionId = req.session.userId || req.session.guestId;

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local';

    if (isRatedLimit(ip)) {
        return res.status(429).json({ error: "Too many requests, try again after 1 hour" });
    }

    setupIpTracking(ip);

    console.log(typeof yourHandler);

    // Check for authenticated user
    const userId = req.session.userId || uuidv4();
    if (!req.session.userId) {
        req.session.userId = userId;
        console.log(`New session created for user: ${userId}`);
    } else {
        console.log(`Using authenticated user session: ${userId}`);
    }

    if (!req.session.chatHistory) {
        console.log("Initializing chat history");
        req.session.chatHistory = [];
    }

    try {
        const { messages } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Messages must be a non-empty array" });
        }

        const validMessages = messages.map(msg => ({ role: "user", ...msg })); // Ensure role is present


        const systemMessage = {
            role: "system",
            content: Prompt
        };

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

        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            finalMessages.push(assistantMessage);

            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);
                const agentName = AGENTS[functionName]?.name || functionName;

                console.log(`Calling ${agentName} with args:`, functionArgs);

                let apiParams = { ...functionArgs };

                if (functionName === 'get_flight_information') {
                    if (functionArgs.departure_location && functionArgs.departure_location.length !== 3) {
                        const iata = getIataCodeFromCity(functionArgs.departure_location);
                        if (iata) {
                            apiParams.originLocationCode = iata;
                            console.log(`Converted departure location "${functionArgs.departure_location}" to IATA: ${iata}`);
                        } else {
                            console.warn(`Could not find IATA code for departure location: ${functionArgs.departure_location}`);
                            continue;
                        }
                        delete apiParams.departure_location;
                    } else if (functionArgs.departure_location) {
                        apiParams.originLocationCode = functionArgs.departure_location;
                        delete apiParams.departure_location;
                    }

                    if (functionArgs.destination && functionArgs.destination.length !== 3) {
                        const iata = getIataCodeFromCity(functionArgs.destination);
                        if (iata) {
                            apiParams.destinationLocationCode = iata;
                            console.log(`Converted destination "${functionArgs.destination}" to IATA: ${iata}`);
                        } else {
                            console.warn(`Could not find IATA code for destination: ${functionArgs.destination}`);
                            continue; 
                        }
                        delete apiParams.destination;
                    } else if (functionArgs.destination) {
                        apiParams.destinationLocationCode = functionArgs.destination;
                        delete apiParams.destination;
                    }

                    const dateResult = parseAndValidateDate(functionArgs.departure_date);
                    if (dateResult.error) {
                        console.warn(`Invalid departure date: ${dateResult.error}`);
                        continue; 
                    }
                    apiParams.departureDate = dateResult.date;
                    delete apiParams.departure_date;

                    apiParams.adults = functionArgs.number_of_passengers;
                    delete apiParams.number_of_passengers;
                    apiParams.travelClass = functionArgs.flight_type.toUpperCase() === 'BUSINESS-CLASS' ? 'BUSINESS' : 'ECONOMY';
                    delete apiParams.flight_type;
                }

                const functionResult = await callAgentApi(functionName, apiParams);

                toolResults.push({
                    agent: agentName,
                    toolCall: toolCall,
                    result: functionResult
                });

                finalMessages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: functionName,
                    content: JSON.stringify(functionResult)
                });
            }

            const response2 = await client.chat.completions.create({
                model: "gpt-4-turbo",
                messages: finalMessages,
                temperature: temperature
            });

            reply = response2.choices[0].message.content;
        }

        if (messages.length > 0) {
            req.session.chatHistory.push({
                role: 'user',
                content: messages[messages.length - 1].content
            });
        }

        req.session.chatHistory.push({
            role: 'assistant',
            content: reply
        });

        // Update or create chat session record in MongoDB
        await chatSession.updateOne(
            { sessionId: sessionId },
            {
                userId: userId,
                chatHistory: req.session.chatHistory,
            },
            { upsert: true, new: true }
        );
        console.log("🔄 MongoDB update payload:", {
            sessionId: sessionId,
            userId: userId,
            chatHistory: req.session.chatHistory
        });

        res.setHeader('X-User-ID', userId.string());
        res.status(200).json({
            reply: reply,
            userId: userId,
            sessionId: sessionId,
            chatHistory: req.session.chatHistory,
            toolResults: toolResults.length > 0 ? toolResults : undefined
        });

    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ error: "An error occurred while processing your request", details: error.message });
    }
});

module.exports = router;