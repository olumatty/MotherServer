const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
});

const chatSessionSchema = new mongoose.Schema({
    chatId: { type: String, required: true, index: true, unique: true }, // ADD THIS FIELD
    sessionId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    chatHistory: [messageSchema],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    aliceInitiated: { type: Boolean, default: false }, // Assuming these are related to your reset logic
    bobRespondedToAlice: { type: Boolean, default: false },
});

chatSessionSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

const chatSession = mongoose.model('chatSession', chatSessionSchema);

module.exports = chatSession;