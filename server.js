// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const verifyToken = require('./middleware/auth')
const authRouter = require('./routes/auth');
const motherRouter = require('./routes/mother');
const createChatRoute = require('./routes/chat');
const cookieParser = require('cookie-parser');

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

// Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/mother', verifyToken, motherRouter);
app.use('/api/v1/chats', verifyToken, createChatRoute);

app.listen(PORT, () => {
    console.log(`The server is running on port ${PORT}`);
});


//TODO: WORK ON CHAT HISTORY
//TODO: WHEN CLIENT REFRESHES HE SHOULD GET THE LATEST CHAT HISTORY.
//Todo: When user clicks on new chat  a new id should should be generated when users start a new conversation.

