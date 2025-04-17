// Message.jsx
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    role: {type:String, enum:['user', 'assistant', 'system','tool'], required: true},
    content: {type:String, required: true},
    timestamp: {type:Date, default: Date.now},
    tool_call_id: {type:String, required: false},
});

const conversationSchema = new mongoose.Schema({
    userId:{type:String, required: true},
    conversationId:{type:String, required: true},
    title:{type:String},
    messges:[messageSchema],
    createdAt:{type:Date, default: Date.now},
    updatedAt:{type:Date, default: Date.now},
});

module.exports = mongoose.model('Conversation', conversationSchema);