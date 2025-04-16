// Message.jsx
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    conversationId: {
        type: String,
        required: true,
        index: true,
    },
    userId: {
        type: String,
        required: true,
    },
    role: {
        type: String,
        enum: ['user', 'assistant'],
        required: true,
    },    
    content: {
        type: String,
        required: true,
    },
    timestamp: {
        type: Date,
        default: Date.now,
    },
});

const Message = mongoose.model('message', messageSchema);
module.exports = Message;