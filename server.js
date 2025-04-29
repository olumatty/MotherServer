const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

const authRouter = require('./routes/auth');
const motherRouter = require('./routes/mother');
const chatRouter = require('./routes/chat');
const cookieParser = require('cookie-parser');


dotenv.config();

const app = express();
const PORT = 8000;


app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: 'http://localhost:5173',
    credentials: true,
    preflightContinue: true, 
    optionsSuccessStatus: 204, 
    allowedHeaders: ['Content-Type', 'Authorization', 'user-id', 'session-id', 'X-User-Gemini-Key'], 
    origin: function (origin, callback) {
        console.log(`CORS middleware checking origin: ${origin}`);
        if (origin === 'http://localhost:5173') { 
            callback(null, true); 
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
  })
);

// Add a simple log here to confirm middleware setup is reached
console.log("CORS middleware configured.");

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/travel', motherRouter);
app.use('/api/v1/chats',  chatRouter);

app.listen(PORT, () => {
    console.log(`The server is running on port ${PORT}`);
});


//TODO : WORK ON THE RATE LIMITING AND TEST THE API INPUT FRONTEND
//TODO : WORK ON THE TITLE SLICE AND SUGGESTIONS
// TODO : DEPLOY TO RENDER.COM