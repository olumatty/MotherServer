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
    origin: 'http://localhost:5173',
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
      collectionName: "sessions",
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      httpOnly: true,
      sameSite: "lax",
      secure: false, // true if you're using HTTPS
    },
  }));
console.log("Session middleware initialized");

app.use(session({
    // session config here
  }));
app.use(isAuthenticated);
app.use(trackUserOrGuest);

// Set header for authenticated users
app.use((req, res, next) => {
    if (req.session.userId) {
        res.setHeader('X-User-ID', req.session.userId);
        console.log(`Setting X-User-ID header to ${req.session.userId}`);
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


//TODO: Work on tool or prompt to stop asking user to confirm the flight they want to book from the information your provided.
//TODO: prompt stiopped showing images when user asks for accommodation or sightseeing
//TODO: WHEN CLIENT LOGOUT , CLIENT SIDE SHOULD CLEAR THE LOCAL STORAGE

