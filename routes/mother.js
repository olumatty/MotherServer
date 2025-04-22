const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Conversation = require('../models/conversation');
const { getIataCodeFromCity } = require('../util/iata');
const Prompt = require('../services/prompt');
const dotenv = require('dotenv');
const { isRateLimited, trackRequest } = require('../middleware/ratelimit');
const authenticateToken = require('../middleware/auth');

dotenv.config();

const temperature = parseFloat(process.env.API_TEMPERATURE) || 0.7;

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

// Correctly formatted tools for Gemini API (using function calling schema)
const tools = [
    {
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
                    enum: ["ECONOMY", "BUSINESS-CLASS", "FIRST-CLASS", "PREMIUM-ECONOMY"],
                    description: "The type of flight: (ECONOMY, BUSINESS-CLASS, FIRST-CLASS, PREMIUM-ECONOMY)"
                },
                number_of_passengers: {
                    type: "integer",
                    description: "The number of passengers for the flight"
                },
            },
            required: ["departure_location", "destination", "departure_date", "flight_type", "number_of_passengers"],
            additionalProperties: false
        }
    },
    {
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
    },
    {
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
];

function parseAndValidateDate(dateString) {
    const currentDate = moment();
    let parsedDate = moment(dateString, 'YYYY-MM-DD', true);

    if (!parsedDate.isValid()) {
        parsedDate = moment(dateString);
        if (!parsedDate.isValid()) {
            return { error: `Could not parse date: ${dateString}. Please useYYYY-MM-DD format.` };
        }
    }

    if (parsedDate.isBefore(currentDate, 'day')) {
        console.warn(`Departure date "<span class="math-inline">\{dateString\}" is in the past\. Assuming current year \(</span>{currentDate.year()}).`);
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

// Main travel agent endpoint
router.post('/', authenticateToken, async (req, res) => {

    if (!req.user || !req.user.userId) {
        return res.status(401).json({ message: 'Unauthorized: No user data' });
    }

    let aliceInitiated = false;
    let bobRespondedToAlice = false;

    const userId = req.user.userId;
    const conversationId = req.body.conversationId || uuidv4();
    const geminiApiKey = req.headers['x-user-gemini-key'] || process.env.GEMINI_API_KEY;
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const geminiModel = genAI.geminiPro; 

    try {
        const { messages } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Messages must be a non-empty array" });
        }

        const validMessages = messages.filter(msg => msg.content && msg.content.trim())
            .map(msg => ({ role: "user", parts: [{ text: msg.content }] }));

        if (validMessages.length === 0) {
            return res.status(400).json({ error: "No valid messages found" });
        }

        const systemMessage = {
            role: "system",
            parts: [{ text: Prompt }]
        };

        // Check if this is a new conversation or continuing an existing one
        let conversation = await Conversation.findOne({
            conversationId: conversationId,
            userId: userId
        });

        const isNewConversation = !conversation;
        if (isNewConversation) {
            // Create a new conversation with user's first message as title
            const firstUserMessageContent = validMessages[0]?.parts[0]?.text;
            const title = firstUserMessageContent?.length > 30
                ? `${firstUserMessageContent.substring(0, 30)}...`
                : firstUserMessageContent || 'New Chat';

            conversation = new Conversation({
                userId: userId,
                conversationId: conversationId,
                title: title,
                messages: [],
                createdAt: new Date(),
                updatedAt: new Date()
            });

            console.log("🚀 New conversation created:", {
                conversationId,
                userId,
                title: conversation.title
            });
        }

        // Ensure messages array exists
        if (!conversation.messages) {
            conversation.messages = [];
        }

        // Get conversation history if it exists
        let chatHistory = [];
        if (conversation.messages && conversation.messages.length > 0) {
            chatHistory = conversation.messages.map(msg => ({
                role: msg.role,
                parts: [{ text: msg.content }],
                ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {})
            }));
        }

        // Build messages to send to Gemini
        const finalMessages = [systemMessage, ...chatHistory];

        // Add the new user message(s)
        for (const msg of validMessages) {
            finalMessages.push(msg);

            // Also add to our conversation object
            conversation.messages.push({
                role: msg.role,
                content: msg.parts[0].text,
                timestamp: new Date()
            });
        }

        const chat = geminiModel.startChat({
            history: finalMessages,
            generationConfig: {
                temperature: temperature,
            },
            tools: [{ function_declarations: tools }],
        });

        const result = await chat.sendMessageStream(validMessages.slice(-1));
        let assistantResponse = '';
        let currentToolCalls = [];
        let finalResponse = null;

        for await (const chunk of result) {
            const chunkData = chunk.candidates?.[0]?.content?.parts?.[0];
            if (chunkData?.text) {
                assistantResponse += chunkData.text;
            }
            const toolCalls = chunk.candidates?.[0]?.content?.tool_calls;
            if (toolCalls && toolCalls.length > 0) {
                currentToolCalls.push(...toolCalls);
            }
        }

        let reply = assistantResponse;
        let toolResults = [];

        if (currentToolCalls.length > 0) {
            finalMessages.push({
                role: "assistant",
                parts: [{ text: assistantResponse }],
                tool_calls: currentToolCalls.map(tc => ({
                    id: tc.id,
                    function: {
                        name: tc.function.name,
                        parameters: JSON.parse(tc.function.arguments)
                    }
                }))
            });

            // Store tool calls in conversation
            conversation.messages.push({
                role: "assistant",
                content: assistantResponse || "",
                tool_calls: currentToolCalls.map(tc => ({
                    id: tc.id,
                    function: {
                        name: tc.function.name,
                        arguments: tc.function.arguments
                    }
                })),
                timestamp: new Date()
            });

            for (const toolCall of currentToolCalls) {
                const functionName = toolCall.function.name;
                const functionArgs = toolCall.function.parameters;
                const agentName = AGENTS[functionName]?.name || functionName;

                console.log(`Calling ${agentName} with args:`, functionArgs);

                let apiParams = { ...functionArgs };
                let functionResult;
                let shouldExecuteTool = true;

                if (functionName === 'get_flight_information') {
                    if (functionArgs.departure_location && functionArgs.departure_location.length !== 3) {
                        const iata = getIataCodeFromCity(functionArgs.departure_location);
                        if (iata) {
                            apiParams.originLocationCode = iata;
                            console.log(`Converted departure location "${functionArgs.departure_location}" to IATA: ${iata}`);
                        } else {
                            console.warn(`Could not find IATA code for departure location: ${functionArgs.departure_location}`);
                            shouldExecuteTool = false;
                            functionResult = { error: `Could not find airport code for: ${functionArgs.departure_location}` };
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
                            shouldExecuteTool = false;
                            functionResult = { error: `Could not find airport code for: ${functionArgs.destination}` };
                        }
                        delete apiParams.destination;
                    } else if (functionArgs.destination) {
                        apiParams.destinationLocationCode = functionArgs.destination;
                        delete apiParams.destination;
                    }

                    const dateResult = parseAndValidateDate(functionArgs.departure_date);
                    if (dateResult.error) {
                        console.warn(`Invalid departure date: ${dateResult.error}`);
                        shouldExecuteTool = false;
                        functionResult = { error: dateResult.error };
                    } else {
                        apiParams.departureDate = dateResult.date;
                        delete apiParams.departure_date;
                    }

                    apiParams.adults = functionArgs.number_of_passengers;
                    delete apiParams.number_of_passengers;
                    apiParams.travelClass = functionArgs.flight_type.toUpperCase() === 'BUSINESS-CLASS' ? 'BUSINESS' : 'ECONOMY';
                    delete apiParams.flight_type;

                    if (shouldExecuteTool) {
                        functionResult = await callAgentApi(functionName, apiParams);
                        aliceInitiated = !functionResult?.error;
                    } else if (!functionResult) {
                        functionResult = { error: "Could not process flight information request." };
                    }
                } else if (functionName === 'get_accomodation') {
                    if (aliceInitiated) {
                        functionResult = await callAgentApi(functionName, apiParams);
                        bobRespondedToAlice = !functionResult?.error;
                    } else {
                        shouldExecuteTool = false;
                        functionResult = { status: "pending", reason: "flight_details_needed" };
                    }
                } else if (functionName === 'get_sightSeeing') {
                    if (aliceInitiated && bobRespondedToAlice) {
                        functionResult = await callAgentApi(functionName, apiParams);
                    } else {
                        shouldExecuteTool = false;
                        functionResult = { status: "pending", reason: "flight_and_accommodation_needed" };
                    }
                } else {
                    functionResult = { error: `Unknown tool: ${functionName}` };
                    shouldExecuteTool = false;
                }

                toolResults.push({
                    agent: agentName,
                    toolCall: toolCall,
                    result: functionResult
                });

                // Add the tool response to our messages array
                const toolMessage = {
                    role: "tool",
                    parts: [{ text: JSON.stringify(functionResult) }],
                    tool_call_id: toolCall.id,
                    name: functionName,
                    timestamp: new Date()
                };

                finalMessages.push(toolMessage);

                // Store in conversation
                conversation.messages.push({
                    role: "tool",
                    content: JSON.stringify(functionResult),
                    tool_call_id: toolCall.id,
                    timestamp: new Date()
                });
            }

            // Get final response from Gemini
            try {
                const response2 = await geminiModel.generateContent({
                    model: "gemini-pro",
                    contents: finalMessages,
                    generationConfig: {
                        temperature: temperature,
                    }
                });

                const finalResponseData = response2.response?.candidates?.[0]?.content?.parts?.[0]?.text;
                reply = finalResponseData || 'No final response from model after tool calls.';
            } catch (error) {
                console.error("Error generating final response:", error);
                reply = "Error generating final response after processing tools.";
            }
        }
        /// Add assistant's final response to conversation
        conversation.messages.push({
            role: "assistant",
            content: reply,
            timestamp: new Date()
        });

        // Update conversation timestamps
        conversation.updatedAt = new Date();

        // Save conversation to database
        await conversation.save();

        console.log("🚀 Conversation updated:", {
            conversationId: conversationId,
            userId: userId,
            aliceInitiated,
            bobRespondedToAlice
        });

        res.setHeader('X-User-ID', userId);
        res.status(200).json({
            reply: reply,
            userId: userId,
            conversationId: conversationId,
            toolResults: toolResults.length > 0 ? toolResults : undefined
        });

    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ error: "An error occurred while processing your request", details: error.message });
    }
});

module.exports = router;