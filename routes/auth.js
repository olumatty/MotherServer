const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('../models/user');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

router.post('/signup', async (req, res) => {
    try {
        const { username, password, email } = req.body;

        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ message: 'Username already exists' });

        const existingEmail = await User.findOne({ email });
        if (existingEmail) return res.status(400).json({ message: 'Email already exists' });

        const userId = uuidv4();
        const user = new User({ username, password, email, userId });
        await user.save();

        const token = jwt.sign({ userId: user.userId }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h'});

        res.status(201).json({ message: 'User registered successfully', userId: user.userId, token });
    } catch (error) {
        res.status(500).json({ message: 'Error registering user', error: error.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(401).json({ message: 'User not found' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Invalid password' });

        const token = jwt.sign({ userId: user.userId }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });

        
        const refreshToken = jwt.sign({ userId: user.userId }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production', 
            sameSite: 'None', // Use 'None' if cross-origin, 'Strict' for more security
            path: '/', 
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days expiration for refresh token
        });

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
            path: '/', 
            maxAge: 24 * 60 * 60 * 1000, // 1 day expiration
        });

        res.status(200).json({ 
            message: 'Login successful', 
            userId: user.userId, 
            email: user.email, 
            username: user.username,
            token: token,
            refreshToken: refreshToken 
        });
    } catch (error) {
        console.error("Login error:", error); 
        res.status(500).json({ message: 'An error occurred during login. Please try again later.' });
    }
});


router.get('/revalidate', (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: 'No token provided' });

    try {
        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET,);
        res.status(200).json({ message: 'Token is valid', userId: decoded.userId });
    } catch (error) {
        res.status(401).json({ message: 'Invalid or expired token' });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('token'); 
    res.status(200).json({ message: 'Logged out successfully' });
});


module.exports = router;