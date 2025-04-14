// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const session = require('express-session');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
const authRouter = require('./routes/auth');
const motherRouter = require('./routes/mother');
const isAuthenticated = require('./middleware/isAuthenticated');
const trackUserOrGuest = require('./middleware/trackUserOrGuest');

dotenv.config();

const app = express();
const PORT = 8000;

// CORS configuration that allows credentials
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173", // Specify your frontend URL
    credentials: true, // This is crucial for cookies/sessions!
  })
);

app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions',
        checkPeriod: 86400000
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax' // Important for cross-origin requests
    }
}));
console.log("Session middleware initialized");

// Apply isAuthenticated middleware globally
app.use(isAuthenticated);

// Then track user or guest status
app.use(trackUserOrGuest);

// Set header for authenticated users
app.use((req, res, next) => {
    if (req.session.userId) {
        res.setHeader('X-User-ID', req.session.userId);
    }
    next();
});

// Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/mother', motherRouter); // No need for isAuthenticated here since it's global

app.get("/get-chat-history", (req, res) => {
    if (req.session.chatHistory) {
        res.status(200).json(req.session.chatHistory);
    } else {
        res.status(200).json([]);
    }
});

app.listen(PORT, () => {
    console.log(`The server is running on port ${PORT}`);
});