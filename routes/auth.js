const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('../models/user');



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

        req.session.userId = user._id;
        req.session.isAuthenticated = true;

        req.session.save(err => {
            if(err) {
                console.error("session save error:", err);
                return res.status(500).json({ message: 'Error saving session', error: err.message });
            }    
         // Set header *before* sending the final response
        res.setHeader('X-User-ID', user._id.toString());
        return res.status(200).json({ message: 'Login successful', userId: user._id });
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

module.exports = router;