const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const Conversation = require('../models/conversation');
const authenticateToken = require('../middleware/auth');

router.post('/create', authenticateToken, async (req, res) => {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({ message: 'Unauthorized: No user data' });
  }

  const { message } = req.body;
  const conversationId = uuidv4();
  const title = message.slice(0, 30);

  try {
    const newChat = await Conversation.create({
      userId: req.user.userId,
      conversationId,
      title,
      messages: [{ role: 'user', content: message }],
    });

    await newChat.save();
    res.json({ conversationId });
    console.log('🚀 New chat created:', newChat);
  } catch (error) {
    console.error('Error creating chat:', error);
    res.status(500).json({ message: 'Error creating chat', error: error.message });
  }
});

router.post('/:conversationId/message', authenticateToken, async (req, res) => {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({ message: 'Unauthorized: No user data' });
  }

  const { conversationId } = req.params;
  const { role, content, tool_call_id } = req.body;

  try {
    const chat = await Conversation.findOne({ conversationId, userId: req.user.userId });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    chat.messages.push({ role, content, tool_call_id });
    chat.updatedAt = new Date();
    await chat.save();

    res.json({ message: 'Message added to chat' });
    console.log('🚀 Message added to chat:', chat);
  } catch (error) {
    console.error('Error adding message:', error);
    res.status(500).json({ message: 'Error adding message', error: error.message });
  }
});

router.get('/:userId/history', authenticateToken, async (req, res) => {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({ message: 'Unauthorized: No user data' });
  }

  if (req.user.userId !== req.params.userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const history = await Conversation.find({ userId: req.user.userId })
      .sort({ updatedAt: -1 })
      .select('conversationId title updatedAt');

    res.json(history);
    console.log('🚀 History found:', history);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ message: 'Error fetching history', error: error.message });
  }
});

router.get('/:conversationId', authenticateToken, async (req, res) => {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({ message: 'Unauthorized: No user data' });
  }

  const { conversationId } = req.params;

  try {
    const chat = await Conversation.findOne({ conversationId, userId: req.user.userId });
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    res.json(chat);
    console.log('🚀 Chat found:', chat);
  } catch (error) {
    console.error('Error fetching chat:', error);
    res.status(500).json({ message: 'Error fetching chat', error: error.message });
  }
});

router.delete('/:conversationId', authenticateToken, async (req, res) => {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: 'Unauthorized: No user data' });
    }
  
    const { conversationId } = req.params;
  
    try {
      const deletedResult = await Conversation.deleteOne({
        conversationId: conversationId,
        userId: req.user.userId,
      });
  
      if (deletedResult.deletedCount > 0) {
        res.json({ message: 'Chat conversation deleted successfully', deletedCount: deletedResult.deletedCount });
        console.log('🚀 Chat conversation deleted:', conversationId, 'for user:', req.user.userId);
      } else {
        res.status(404).json({ message: 'Chat conversation not found or you do not have permission to delete it.' });
      }
    } catch (error) {
      console.error('Error deleting chat conversation:', error);
      res.status(500).json({ message: 'Error deleting chat conversation', error: error.message });
    }
  });

module.exports = router;