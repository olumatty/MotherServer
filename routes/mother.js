const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Conversation = require('../models/conversation');
const { getIataCodeFromCity } = require('../util/iata');
const Prompt = require('../services/geminiprompt');
const dotenv = require('dotenv');
const authenticateToken = require('../middleware/auth');
const { getFullAirlineName } = require('../util/airlineUtils');
const { rateLimitMiddleware } = require('../middleware/ratelimit');

dotenv.config();

const AGENTS = {
    get_flight_information: {
        name: "Alice (Flight Agent)",
        endpoint: process.env.FLIGHT_AGENT_URL || "https://travelai-com-v1-flight.onrender.com/v1/get-flight-prices"
    },
    get_accomodation: {
        name: "Bob (Accomodation Agent)",
        endpoint: process.env.ACCOMMODATION_AGENT_URL || "https://travelai-accomodation.onrender.com/v1/get_accommodation"
    },
    get_sightSeeing: {
        name: "Charlie (Sightseeing Agent)",
        endpoint: process.env.SIGHTSEEING_AGENT_URL || "https://travelai-sightseeing.onrender.com/v1/get_sight_seeing"
    }
};

const tools = {
    functionDeclarations: [
        {
            "name": "get_flight_information",
            "description": "Get flight information from Alice (Flight Agent) based on user input",
            "parameters": {
                "type": "object",
                "properties": {
                    "departure_location": { "type": "string", "description": "The location or airport where the flight is departing from (e.g., BOM, DEL, LOS, DXB, NYK)" },
                    "destination": { "type": "string", "description": "The destination city or airport (e.g., BOM, DEL, LOS, DXB, NYK)" },
                    "departure_date": { "type": "string", "description": "The date of departure in YYYY-MM-DD format" },
                    "flight_type": { "type": "string", "enum": ["ECONOMY", "BUSINESS-CLASS", "FIRST-CLASS", "PREMIUM-ECONOMY"], "description": "The type of flight" },
                    "number_of_passengers": { "type": "integer", "description": "The number of passengers for the flight" }
                },
                "required": ["departure_location", "destination", "departure_date", "flight_type", "number_of_passengers"]
            }
        },
        {
            "name": "get_accomodation",
            "description": "Get accommodation options from Bob (Accommodation Agent)",
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": { "type": "string", "description": "The destination city or location and the country (e.g., Lagos, Nigeria)" },
                    "checkInDate": { "type": "string", "description": "The date of check-in in YYYY-MM-DD format" },
                    "checkOutDate": { "type": "string", "description": "The date of check-out in YYYY-MM-DD format" }
                },
                "required": ["destination", "checkInDate", "checkOutDate"]
            }
        },
        {
            "name": "get_sightSeeing",
            "description": "Get sightseeing recommendations from Charlie (Sightseeing Agent)",
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": { "type": "string", "description": "The destination city or location for sightseeing" }
                },
                "required": ["destination"]
            }
        }
    ]
};

function parseAndValidateDate(dateString) {
    const currentDate = moment();
    const parsedDate = moment(dateString, 'YYYY-MM-DD', true);
    if (!parsedDate.isValid()) {
        return { error: `Invalid date: ${dateString}. Please use YYYY-MM-DD format.` };
    }
    if (parsedDate.isBefore(currentDate, 'day')) {
        console.warn(`Date "${dateString}" is in the past. Please provide a future date.`);
        return { error: `Date ${dateString} is in the past. Please provide a future date.` };
    }
    return { date: parsedDate.format('YYYY-MM-DD') };
}

async function callAgentApi(toolName, parameters) {
    try {
        const agent = AGENTS[toolName];
        if (!agent) throw new Error(`No agent defined for tool: ${toolName}`);
        console.log(`Calling ${agent.name} for information...`);

        const retry = async (fn, retries = 3, delay = 2000) => {
            for (let i = 0; i < retries; i++) {
                try {
                    return await fn();
                } catch (error) {
                    if (i === retries - 1 || !error.response || error.response.status !== 502) throw error;
                    console.log(`Retrying ${agent.name} (attempt ${i + 1})...`);
                    await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
                }
            }
        };

        let response;
        if (toolName === "get_accomodation" || toolName === "get_sightSeeing") {
            response = await retry(() => axios.get(agent.endpoint, { params: parameters, timeout: 60000 }));
        } else {
            console.log(`DEBUG: Sending to ${agent.name}:`, JSON.stringify(parameters, null, 2));
            response = await retry(() => axios.post(agent.endpoint, parameters, {
                headers: { 'Origin': 'https://travelai-server.onrender.com/travel' },
                timeout: 60000
            }));
        }

        if (response.status !== 200) {
            console.error(`Error from ${agent.name} API: Status ${response.status}`, response.data || 'No data returned');
            return {
                agent: agent.name,
                error: `Failed to get data from ${agent.name}. API returned status: ${response.status}`,
                details: response.data || 'No details available'
            };
        }

        return { agent: agent.name, ...response.data };
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

router.post('/', authenticateToken, async (req, res) => {
    if (!req.user || !req.user.userId) {
        return res.status(401).json({ message: 'Unauthorized: No user data' });
    }

    const userId = req.user.userId;
    const conversationId = req.body.conversationId || uuidv4();
    const geminiApiKey = req.headers['x-user-gemini-key'] || process.env.GEMINI_API_KEY;

    let toolExecutionState = {
        flightInfoProvided: false,
        accommodationBooked: false
    };

    try {
        if (!geminiApiKey) {
            throw new Error("Missing Gemini API key. Please provide a valid API key.");
        }

        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const geminiModel = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: "You are a helpful assistant."
        });

        const { messages } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Messages must be a non-empty array" });
        }

        const validMessages = messages
            .filter(msg => msg.content && msg.content.trim())
            .map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));

        if (validMessages.length === 0) {
            return res.status(400).json({ error: "No valid messages found" });
        }

        let conversation = await Conversation.findOne({
            conversationId: conversationId,
            userId: userId
        });

        const isNewConversation = !conversation;
        let finalMessages = [];

        if (isNewConversation) {
            conversation = await createNewConversation(userId, conversationId, validMessages, Prompt);
            finalMessages.push({ role: "user", parts: [{ text: validMessages[0].parts[0].text }] });
        } else {
            finalMessages = loadConversationHistory(conversation);
            toolExecutionState = determineToolExecutionState(conversation.messages);

            for (const msg of validMessages) {
                const geminiRole = msg.role === "assistant" ? "model" : msg.role;
                finalMessages.push({ role: geminiRole, parts: msg.parts });

                conversation.messages.push({
                    role: msg.role === "user" ? "user" : "assistant",
                    content: msg.parts[0].text || "Empty message",
                    timestamp: new Date()
                });
            }
        }

        console.log("Final Messages for startChat:", JSON.stringify(finalMessages, null, 2));
        finalMessages.forEach((msg, index) => {
            if (!msg.role || (!msg.parts && msg.role !== "function") || (msg.role === "function" && !msg.name)) {
                console.error(`Invalid message at index ${index}:`, msg);
                throw new Error(`Invalid message format in history at index ${index}`);
            }
        });

        const chat = geminiModel.startChat({
            history: finalMessages,
            tools: tools,
            systemInstruction: { parts: [{ text: Prompt }] }
        });

        try {
            const result = await chat.sendMessage(validMessages.slice(-1)[0].parts[0].text);
            const { assistantResponse, toolCalls } = extractResponseAndToolCalls(result);
            console.log("Assistant Response:", assistantResponse);
            console.log("Gemini Raw Response:", JSON.stringify(result.response, null, 2));

            let reply = assistantResponse || "I received your message.";
            let toolResults = [];

            if (toolCalls.length > 0) {
                storeAssistantResponseWithToolCalls(conversation, assistantResponse, toolCalls);
                toolResults = await processToolCalls(toolCalls, toolExecutionState);

                for (const toolResult of toolResults) {
                    // Format toolResult content for schema (function role)
                    let content;
                    if (toolResult.result.error) {
                        content = `Error: ${toolResult.result.error}. Details: ${toolResult.result.message || toolResult.result.details || 'No details'}`;
                    } else if (toolResult.agent === "Alice (Flight Agent)") {
                        if (toolResult.result.top_flights.length === 0) {
                            content = `No flights found for ${toolResult.result.extractedInfo.originLocationCode} to ${toolResult.result.extractedInfo.destinationLocationCode} on ${toolResult.result.extractedInfo.departureDate} in ${toolResult.result.extractedInfo.travelClass}.`;
                        } else {
                            content = toolResult.result.top_flights.map(f => 
                                `Flight by ${getFullAirlineName(f.airline)}, Price: ${f.currency} ${f.price}, Departure: ${f.departureDate} ${f.departureTime}, Duration: ${f.duration}, Stops: ${f.stops}`
                            ).join("; ");
                        }
                    } else {
                        content = JSON.stringify(toolResult.result);
                    }

                    conversation.messages.push({
                        role: "function",
                        content: content,
                        tool_call_id: toolResult.toolCall.id,
                        name: toolResult.toolCall.function.name,
                        timestamp: new Date()
                    });
                }

                reply = await generateFinalResponse(geminiModel, toolResults);
            }

            conversation.messages.push({
                role: "assistant",
                content: reply || "I processed your request.",
                timestamp: new Date()
            });

            // Title generation logic (unchanged)
            const MIN_MESSAGES_FOR_TITLE = 1;
            const MAX_MESSAGES_TO_CONSIDER_FOR_TITLE = 10;
            const initialTitleFromSlice = conversation.messages[0]?.content?.slice(0, 30);
            const hasDefaultTitle = conversation.title === "New Chat";
            const needsTitleGeneration = !conversation.title || hasDefaultTitle;

            if (
                conversation.messages.length > MIN_MESSAGES_FOR_TITLE &&
                conversation.messages.length < MAX_MESSAGES_TO_CONSIDER_FOR_TITLE &&
                needsTitleGeneration
            ) {
                try {
                    console.log("Attempting to suggest title...");
                    const messagesForTitlePrompt = conversation.messages.slice(0, MAX_MESSAGES_TO_CONSIDER_FOR_TITLE);
                    let promptMessages = messagesForTitlePrompt
                        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
                        .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: "${msg.content?.substring(0, 150)}..."`)
                        .join('\n');

                    const titlePrompt = `Analyze the following conversation exchange to determine the main topic and suggest a very concise title (under 10 words). Respond with only the suggested title:\n\n${promptMessages}\n\nSuggested Title:`;
                    const titleResult = await geminiModel.generateContent({
                        contents: [{ role: "user", parts: [{ text: titlePrompt }] }]
                    });

                    const suggestedTitle = titleResult?.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                    if (suggestedTitle && suggestedTitle !== conversation.title) {
                        conversation.title = suggestedTitle;
                        console.log(`🚀 Conversation ${conversation.conversationId} title updated to: "${suggestedTitle}"`);
                    } else {
                        console.log("Title suggestion returned no valid title or the same title.");
                    }
                } catch (titleError) {
                    console.error('Error suggesting or updating title:', titleError.message);
                }
            }

            conversation.updatedAt = new Date();
            await conversation.save();

            console.log("🚀 Conversation updated:", {
                conversationId,
                userId,
                toolExecutionState,
                finalTitle: conversation.title
            });

            // Return required fields, with toolResults formatted
            res.setHeader('X-User-ID', userId);
            res.status(200).json({
                reply,
                conversationId,
                userId,
                toolResults: toolResults.map(tr => ({
                    agent: tr.agent,
                    toolCall: tr.toolCall,
                    result: tr.result // Raw result for frontend logic, but UI should use reply
                }))
            });
        } catch (error) {
            handleChatError(error, conversation, res);
        }
    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ error: "An error occurred while processing your request", details: error.message });
    }
});


async function createNewConversation(userId, conversationId, validMessages) {
    const firstUserMessageContent = validMessages[0]?.parts[0]?.text;
    const title = firstUserMessageContent?.length > 30
        ? `${firstUserMessageContent.substring(0, 30)}...`
        : firstUserMessageContent || 'New Chat';

    const conversation = new Conversation({
        userId,
        conversationId,
        title,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date()
    });

    if (validMessages.length > 0) {
        conversation.messages.push({
            role: validMessages[0].role,
            content: validMessages[0].parts[0].text,
            timestamp: new Date()
        });
    }

    console.log("🚀 New conversation created:", {
        conversationId,
        userId,
        title: conversation.title
    });

    await conversation.save();
    return conversation;
}

function loadConversationHistory(conversation) {
    if (!conversation.messages || conversation.messages.length === 0) {
        console.log("loadConversationHistory: No messages found in conversation history to load.");
        return [];
    }

    console.log("loadConversationHistory: Loading conversation history...");
    return conversation.messages
        .filter(msg => msg.role !== "system")
        .map(msg => {
            let historyMessage = null;
            try {
                switch (msg.role) {
                    case "user":
                        if (msg.content && msg.content.trim()) {
                            historyMessage = {
                                role: "user",
                                parts: [{ text: msg.content.trim() }]
                            };
                        } else {
                            console.warn(`loadConversationHistory: Skipping invalid user message (empty content): ${JSON.stringify(msg)}`);
                        }
                        break;
                    case "assistant":
                        let parts = [];
                        if (msg.content && msg.content.trim()) {
                            parts.push({ text: msg.content.trim() });
                        }
                        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                            for (const toolCall of msg.tool_calls) {
                                if (toolCall.function && toolCall.function.name && toolCall.function.arguments !== undefined) {
                                    try {
                                        const args = typeof toolCall.function.arguments === 'string'
                                            ? JSON.parse(toolCall.function.arguments)
                                            : toolCall.function.arguments;
                                        parts.push({
                                            functionCall: {
                                                name: toolCall.function.name,
                                                args: args
                                            }
                                        });
                                    } catch (e) {
                                        console.error(`loadConversationHistory: Error parsing tool call arguments:`, e.message);
                                    }
                                }
                            }
                        }
                        if (parts.length > 0) {
                            historyMessage = {
                                role: "model",
                                parts: parts
                            };
                        } else {
                            console.warn(`loadConversationHistory: Skipping invalid assistant message: ${JSON.stringify(msg)}`);
                        }
                        break;
                    case "function":
                        if (!msg.name || typeof msg.content === 'undefined' || typeof msg.tool_call_id === 'undefined') {
                            console.warn(`loadConversationHistory: Skipping invalid function message: ${JSON.stringify(msg)}`);
                            break;
                        }
                        historyMessage = {
                            role: "function",
                            parts: [{
                                functionResponse: {
                                    name: msg.name,
                                    response: {}
                                }
                            }],
                            tool_call_id: msg.tool_call_id
                        };
                        try {
                            historyMessage.parts[0].functionResponse.response = typeof msg.content === 'string'
                                ? JSON.parse(msg.content)
                                : msg.content || { value: msg.content };
                        } catch (e) {
                            console.warn("loadConversationHistory: Failed to parse function message content:", msg.content);
                            historyMessage.parts[0].functionResponse.response = { raw_content: msg.content };
                        }
                        break;
                    default:
                        console.warn(`loadConversationHistory: Unknown message role: ${msg.role}`);
                        break;
                }
            } catch (e) {
                console.error(`loadConversationHistory: Error processing message with role ${msg.role}:`, e, msg);
            }
            return historyMessage;
        })
        .filter(msg => msg !== null);
}

function determineToolExecutionState(messages) {
    let state = {
        flightInfoProvided: false,
        accommodationBooked: false
    };

    if (!messages) return state;

    for (const msg of messages) {
        if ((msg.role === "tool" || msg.role === "function") && msg.name === "get_flight_information") {
            try {
                const result = JSON.parse(msg.content);
                if (!result.error) {
                    state.flightInfoProvided = true;
                }
            } catch (e) {}
        }
        if ((msg.role === "tool" || msg.role === "function") && msg.name === "get_accomodation") {
            try {
                const result = JSON.parse(msg.content);
                if (!result.error) {
                    state.accommodationBooked = true;
                }
            } catch (e) {}
        }
    }

    return state;
}

function extractResponseAndToolCalls(result) {
    let assistantResponse = '';
    let toolCalls = [];

    if (!result.response?.candidates?.length) {
        console.error("No candidates found in Gemini response:", result.response);
        return { assistantResponse: "No response from assistant", toolCalls: [] };
    }

    const candidate = result.response.candidates[0];
    if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.text) {
                assistantResponse += part.text;
            } else if (part.functionCall) {
                toolCalls.push({
                    id: part.functionCall.name + "_" + uuidv4().substring(0, 8),
                    function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args || {})
                    }
                });
            }
        }
    }

    return { assistantResponse, toolCalls };
}

function storeAssistantResponseWithToolCalls(conversation, assistantResponse, toolCalls) {
    conversation.messages.push({
        role: "assistant",
        content: assistantResponse || "Processing your request...",
        tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            function: {
                name: tc.function.name,
                arguments: tc.function.arguments
            }
        })),
        timestamp: new Date()
    });
}

async function processToolCalls(toolCalls, toolExecutionState) {
    const toolResults = [];

    for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name;
        const agentName = AGENTS[functionName]?.name || functionName;
        console.log(`Calling ${agentName} with args:`, toolCall.function.arguments);

        let functionArgs;
        try {
            functionArgs = typeof toolCall.function.arguments === 'string'
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function.arguments;
        } catch (error) {
            console.error(`Error parsing tool call arguments for ${functionName}:`, error.message);
            toolResults.push({
                agent: agentName,
                toolCall: toolCall,
                result: { error: `Invalid tool call arguments: ${error.message}` }
            });
            continue;
        }

        let apiParams = { ...functionArgs };
        let functionResult;
        let shouldExecuteTool = true;

        if (functionName === 'get_flight_information') {
            const processedParams = processFlightParams(functionArgs);
            if (processedParams.error) {
                shouldExecuteTool = false;
                functionResult = { error: processedParams.error };
            } else {
                apiParams = processedParams.params;
                if (shouldExecuteTool) {
                    functionResult = await callAgentApi(functionName, apiParams);
                    toolExecutionState.flightInfoProvided = !functionResult?.error;
                }
            }
        } else if (functionName === 'get_accomodation') {
            const hasAccommodationDates = apiParams.checkInDate && apiParams.checkOutDate;
            if (toolExecutionState.flightInfoProvided || hasAccommodationDates) {
                functionResult = await callAgentApi(functionName, apiParams);
                toolExecutionState.accommodationBooked = !functionResult?.error;
            } else {
                shouldExecuteTool = false;
                functionResult = {
                    status: "pending",
                    reason: "dates_needed",
                    message: "To find accommodation, I need the check-in and check-out dates for your stay."
                };
            }
        } else if (functionName === 'get_sightSeeing') {
            if (toolExecutionState.flightInfoProvided && toolExecutionState.accommodationBooked) {
                functionResult = await callAgentApi(functionName, apiParams);
            } else {
                shouldExecuteTool = false;
                functionResult = {
                    status: "pending",
                    reason: "flight_and_accommodation_needed",
                    message: "Please complete flight and accommodation booking before planning sightseeing."
                };
            }
        } else {
            functionResult = { error: `Unknown tool: ${functionName}` };
            shouldExecuteTool = false;
        }

        toolResults.push({
            agent: agentName,
            toolCall: toolCall,
            result: functionResult || { error: "No result returned from tool" }
        });
    }
    console.log("DEBUG: processToolCalls returning toolResults:", JSON.stringify(toolResults, null, 2));
    return toolResults;
}

function processFlightParams(functionArgs) {
    const apiParams = {};
    const errors = [];

    if (functionArgs.departure_location) {
        if (functionArgs.departure_location.length !== 3) {
            const iata = getIataCodeFromCity(functionArgs.departure_location);
            if (iata) {
                apiParams.originLocationCode = iata;
                console.log(`Converted departure location "${functionArgs.departure_location}" to IATA: ${iata}`);
            } else {
                errors.push(`Could not find airport code for departure location: ${functionArgs.departure_location}`);
            }
        } else {
            apiParams.originLocationCode = functionArgs.departure_location;
        }
    } else {
        errors.push("Departure location is required");
    }

    if (functionArgs.destination) {
        if (functionArgs.destination.length !== 3) {
            const iata = getIataCodeFromCity(functionArgs.destination);
            if (iata) {
                apiParams.destinationLocationCode = iata;
                console.log(`Converted destination "${functionArgs.destination}" to IATA: ${iata}`);
            } else {
                errors.push(`Could not find airport code for destination: ${functionArgs.destination}`);
            }
        } else {
            apiParams.destinationLocationCode = functionArgs.destination;
        }
    } else {
        errors.push("Destination is required");
    }

    if (functionArgs.departure_date) {
        const dateResult = parseAndValidateDate(functionArgs.departure_date);
        if (dateResult.error) {
            errors.push(dateResult.error);
        } else {
            apiParams.departureDate = dateResult.date;
        }
    } else {
        errors.push("Departure date is required");
    }

    apiParams.adults = functionArgs.number_of_passengers || 1;
    apiParams.travelClass = functionArgs.flight_type?.toUpperCase() === 'BUSINESS-CLASS' ? 'BUSINESS' : 'ECONOMY';

    if (errors.length > 0) {
        return { error: errors.join(". ") };
    }

    return { params: apiParams };
}

async function generateFinalResponse(geminiModel, toolResults) {
    try {
        console.log("DEBUG: toolResults received in generateFinalResponse:", JSON.stringify(toolResults, null, 2));

        let toolResultText = toolResults.map(tr => {
            console.log(`DEBUG: Processing result for agent ${tr.agent}:`, tr.result);

            let processedResult = tr.result;
            if (tr.agent === "Alice (Flight Agent)" && processedResult && processedResult.top_flights) {
                try {
                    processedResult = JSON.parse(JSON.stringify(tr.result));
                    processedResult.top_flights = processedResult.top_flights.map(flight => {
                        if (flight.airline) {
                            const fullName = getFullAirlineName(flight.airline);
                            return { ...flight, airline: fullName };
                        }
                        return flight;
                    });
                    console.log(`DEBUG: Processed flight results with full names:`, processedResult.top_flights);
                } catch (e) {
                    console.error("Error during flight result pre-processing:", e);
                    processedResult = tr.result;
                }
            }

            // Format result for Gemini prompt
            if (processedResult.error) {
                return `${tr.agent}: Error - ${processedResult.error}. Details: ${processedResult.message || processedResult.details || 'No details available'}`;
            } else if (tr.agent === "Alice (Flight Agent)") {
                if (processedResult.top_flights.length === 0) {
                    return `${tr.agent}: No flights found for ${processedResult.extractedInfo.originLocationCode} to ${processedResult.extractedInfo.destinationLocationCode} on ${processedResult.extractedInfo.departureDate} in ${processedResult.extractedInfo.travelClass}.`;
                }
                const flightDetails = processedResult.top_flights.map(f => 
                    `Flight by ${f.airline}, Price: ${f.currency} ${f.price}, Departure: ${f.departureDate} ${f.departureTime}, Duration: ${f.duration}, Stops: ${f.stops}`
                ).join("; ");
                return `${tr.agent}: Found ${processedResult.top_flights.length} flights: ${flightDetails}`;
            } else {
                return `${tr.agent}: ${JSON.stringify(processedResult)}`;
            }
        }).join("\n\n");

        const finalPrompt = `You are a travel assistant. Based on the following information from tools, provide a concise, user-friendly summary for the user. Do not include raw JSON, technical details, or phrases like "Information from Alice received successfully." If no flights are found, suggest next steps (e.g., try different dates or contact support). Information:\n\n${toolResultText}\n\nSummary:`;

        console.log("DEBUG: Final prompt for Gemini:", finalPrompt);

        const response = await geminiModel.generateContent({
            contents: [{ role: "user", parts: [{ text: finalPrompt }] }]
        });

        if (response.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            return response.response.candidates[0].content.parts[0].text;
        }

        return "I have processed your travel request, but couldn't generate a summary. Please try again.";
    } catch (error) {
        console.error("Error generating final response:", error);
        return "Sorry, I encountered an issue while summarizing your travel request. Please try again or contact support.";
    }
}

function handleChatError(error, conversation, res) {
    console.error("Error in chat processing:", error);
    conversation.messages.push({
        role: "assistant",
        content: "I'm sorry, I encountered an error while processing your request. Please try again later.",
        timestamp: new Date()
    });
    conversation.updatedAt = new Date();
    conversation.save().catch(saveErr => {
        console.error("Error saving conversation after error:", saveErr);
    });
    res.status(500).json({
        error: "Error processing your chat request",
        message: error.message || "Unknown error"
    });
}

module.exports = router;