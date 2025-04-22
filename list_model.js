const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function listAvailableModels() {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const genAI = new GoogleGenerativeAI(geminiApiKey);

    try {
        if (genAI.preview && genAI.preview.models && genAI.preview.models.geminiPro && genAI.preview.models.geminiPro.listModels) {
            const modelsResponse = await genAI.preview.models.geminiPro.listModels();
            const models = modelsResponse.models;
            console.log("Available Gemini Models:");
            models.forEach(model => {
                console.log(`- Name: ${model.name}`);
                console.log(`  Description: ${model.description}`);
                console.log(`  Supported Generation Methods: ${model.supportedGenerationMethods}`);
                console.log("---");
            });
        } else if (genAI.preview && genAI.preview.listModels) {
            // Fallback to the previous preview method
            const modelsResponse = await genAI.preview.listModels();
            const models = modelsResponse.models;
            console.log("Available Gemini Models (using fallback):");
            models.forEach(model => {
                console.log(`- Name: ${model.name}`);
                console.log(`  Description: ${model.description}`);
                console.log(`  Supported Generation Methods: ${model.supportedGenerationMethods}`);
                console.log("---");
            });
        }
         else {
            console.error("Neither genAI.preview.models.geminiPro.listModels nor genAI.preview.listModels is a function.");
        }
    } catch (error) {
        console.error("Error listing models:", error);
    }
}

listAvailableModels();