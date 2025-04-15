const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('../models/user');
const chatSession = require('../models/chatSession');
const { v4: uuidv4 } = require('uuid');



router.post('/signup', async (req, res) => {
    try {
        const { username, password, email } = req.body;ß
        // Check if username already exists
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists' });
        }
        
        // Check if email already exists
        const existingEmail = await User.findOne({ email });
        if (existingEmail) {
            return res.status(400).json({ message: 'Email already exists' });
        }
        
        const user = new User({ username, password, email });
        await user.save();
        req.session.userId = user._id;
        req.session.isAuthenticated = true;
        res.status(201).json({ message: 'User registered successfully', userId: user._id });
    } catch (error) {
        res.status(500).json({ message: 'Error registering user', error: error.message });
    }
});


router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'User not found' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        // Check if the user already has a chatId
        if (!user.chatId) {
            // Generate a new chatId using uuid (assuming you have uuid imported)
            // // Import uuid here if not already at the top
            user.chatId = uuidv4();
            await user.save(); // Save the updated user with the new chatId
        }

        req.session.userId = user._id;
        req.session.isAuthenticated = true;
        req.session.chatId = user.chatId; // Store chatId in the session
        console.log("User logged in, session ID:", req.sessionID);
        console.log("Session contents:", req.session);

        req.session.save(err => {
            if(err) {
                console.error("session save error:", err);
                return res.status(500).json({ message: 'Error saving session', error: err.message });
            }
            // Set header *before* sending the final response
            res.setHeader('X-User-ID', user._id.toString());

            return res.status(200).json({ message: 'Login successful', userId: user._id, chatId: user.chatId }); // Send chatId in the response
        });
    } catch (error) {
        return res.status(500).json({ message: 'Error logging in', error: error.message });
    }
});

router.post('/logout', async(req, res) => {
    try {
        req.session.destroy();
        res.clearCookie('connect.sid');
        res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error logging out', error: error.message });
    }   
});

router.post('/reset-chat-state', async(req, res) => {
    const {chatId} = req.body;

    if(!chatId){
        return res.status(400).json({ message: 'Chat ID is required' });
    }

    try{
        const updatedSession = await chatSession.findOneAndUpdate
        ({chatId: chatId},
        {
            aliceInitiated: false,
            bobRespondedToAlice: false
        },
        {new: true}

    );
    if(updatedSession){
        return res.status(200).json({ message: 'Chat state reset successfully' });

    }  else {
        return res.status(500).json({ message: 'Error resetting chat state' });
    }

    } catch (error) {
        return res.status(500).json({ message: 'Error resetting chat state', error: error.message });
    }
});





module.exports = router;