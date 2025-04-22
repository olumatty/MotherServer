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
        function_declarations: [
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
                    required: ["departure_location", "destination", "departure_date", "flight_type", "number_of_passengers"]
                }
            }
        ]
    },
    {
        function_declarations: [
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
                            description: "The date of check-in inYYYY-MM-DD format"
                        },
                        checkOutDate: {
                            type: "string",
                            description: "The date of check-out inYYYY-MM-DD format"
                        }

                    },
                    required: ["destination", "checkInDate", "checkOutDate"]
                }
            }
        ]
    },
    {
        function_declarations: [
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
                    required: ['destination']
                }
            }
        ]
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

    try {
        // Check if API key is valid
        if (!geminiApiKey) {
            throw new Error("Missing Gemini API key. Please provide a valid API key.");
        }

        // Initialize the Gemini client
        const genAI = new GoogleGenerativeAI(geminiApiKey);

        // Get the model using getGenerativeModel method
        const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Add debug logging to confirm model is correctly initialized
        console.log("genAI initialized:", !!genAI);
        console.log("geminiModel initialized:", !!geminiModel);

        const { messages } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Messages must be a non-empty array" });
        }

        // Make a copy of messages to avoid modifying the original
        const validMessages = messages.filter(msg => msg.content && msg.content.trim())
            .map(msg => ({ role: "user", parts: [{ text: msg.content }] }));

        if (validMessages.length === 0) {
            return res.status(400).json({ error: "No valid messages found" });
        }

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

            // For new conversations, prepend the system prompt to the first user message
            // This is the key fix to make it work with Gemini's API which doesn't support system messages
            if (validMessages.length > 0) {
                validMessages[0].parts[0].text = `<span class="math-inline">\{Prompt\}\\n\\n</span>{validMessages[0].parts[0].text}`;
            }
        }

        // Ensure messages array exists
        if (!conversation.messages) {
            conversation.messages = [];
        }

        // Get conversation history if it exists
        let chatHistory = [];
        if (conversation.messages && conversation.messages.length > 0) {
            chatHistory = conversation.messages.map(msg => ({
                role: msg.role === "system" ? "user" : (msg.role === "assistant" ? "model" : msg.role),
                parts: [{ text: msg.content }],
                ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {})
            }));
        }

        // Build messages to send to Gemini - without a system message
        const finalMessages = [...chatHistory];

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

        // Create a chat session using the correct API method
        // Note: We're not including a system message in history anymore
        const chat = geminiModel.startChat({
            history: finalMessages,
            tools: tools
        });

        const result = await chat.sendMessageStream(validMessages.slice(-1)[0].parts[0].text);
        let assistantResponse = '';
        let currentToolCalls = [];

        for await (const chunk of result.stream) {
            console.log("--- Stream Chunk ---");
            console.log(chunk);
            
            // Check if chunk has candidates
            if (chunk.candidates && chunk.candidates.length > 0) {
                const candidate = chunk.candidates[0];
                if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                    for (const part of candidate.content.parts) {
                        if (part.text && typeof part.text === 'string') {
                            assistantResponse += part.text;
                        } else if (part.functionCall) {
                            // Handle tool calls
                            currentToolCalls.push({
                                id: part.functionCall.id || uuidv4(),
                                function: {
                                    name: part.functionCall.name,
                                    arguments: JSON.stringify(part.functionCall.args)
                                }
                            });
                        }
                    }
                }
            }
        }
        console.log("Assistant Response (after stream):", assistantResponse);
        console.log("Assistant Response (after stream):", assistantResponse);
        let reply = assistantResponse;
        let toolResults = [];

        if (currentToolCalls.length > 0) {
            finalMessages.push({
                role: "model",
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
                const functionArgs = typeof toolCall.function.arguments === 'string'
                    ? JSON.parse(toolCall.function.arguments)
                    : toolCall.function.arguments;

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
                    contents: finalMessages,
                });
                console.log("--- Final generateContent Response ---");
                console.log(response2);
                
                let finalResponseData = '';
                if (
                    response2.response &&
                    response2.response.candidates &&
                    response2.response.candidates[0] &&
                    response2.response.candidates[0].content &&
                    response2.response.candidates[0].content.parts &&
                    response2.response.candidates[0].content.parts[0] &&
                    response2.response.candidates[0].content.parts[0].text
                ) {
                    finalResponseData = response2.response.candidates[0].content.parts[0].text;
                }
                
                console.log("Final Response Data:", finalResponseData);
                reply = finalResponseData || 'No final response from model after tool calls.';
            } catch (error) {
                console.error("Error generating final response:", error);
                reply = "Error generating final response after processing tools.";
            }
        }
        // Add assistant's final response to conversation
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