// routes/chat.js
const express = require('express');
const router = express.Router();
const ChatSession = require('../models/chatSession');
const Message = require('../models/message');
const verifyToken = require('../middleware/auth');

// Get chat history for the logged-in user
router.get('/history', verifyToken, async (req, res) => {
    const userId = req.user.userId;  // Extract userId from JWT

    try {
        const chatHistory = await ChatSession.find({ userId: userId })
            .sort({ updatedAt: 'desc' })
            .select('chatId updatedAt');

        res.status(200).json(chatHistory);
    } catch (error) {
        console.error('Error fetching chat history:', error);
        res.status(500).json({ message: 'Failed to fetch chat history' });
    }
});

// Get messages for a specific chat ID
router.get('/:chatId', verifyToken, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.userId;  // Extract userId from JWT

    console.log("Fetching chat for chatId:", chatId);
    console.log("UserId from JWT:", userId);

    try {
        const chatSession = await ChatSession.findOne({ chatId: chatId, userId: userId });

        if (!chatSession) {
            return res.status(403).json({ message: 'Access denied to this chat' });
        }

        const messages = await Message.find({ chatId: chatId }).sort({ timestamp: 1 });

        const formattedMessages = messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp
        }));

        res.status(200).json(formattedMessages);
    } catch (error) {
        console.error('Error fetching messages for chat:', error);
        res.status(500).json({ message: 'Failed to fetch messages' });
    }
});

module.exports = router;
