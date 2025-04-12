const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const session = require('express-session');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');


dotenv.config();

const app = express();
const PORT = 8000;

app.use(express.json());
app.use(cors());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions',
        checkPeriod: 86400000
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 3600000 * 24 * 7
    }
}));
console.log("Session middleware initialized");


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

// TODO: CREATE AN HELPER THAT GET CURRENT DATE AND TIME
// TODO: CREATE A SCHEMA FOR USER LOGIN AND REGISTER
// TOD0: MAKE THE USER LOGIN AND REGISTER ROUTES
// TODO: EACH USER SHOULD HAVE A DIFFERENT SESSION ID ,USER ID AND CHAT HISTORY
//