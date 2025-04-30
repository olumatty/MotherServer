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
app.use(cors({
  origin: 'https://travelai-nu.vercel.app',  
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'user-id', 'userId', 'user-token', 'conversationId', 'X-User-Gemini-Key', 'session-id'],
  credentials: true,  
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));

console.log("CORS middleware configured.");

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/travel', motherRouter);
app.use('/api/v1/chats',  chatRouter);


// Global error handler middleware
app.use((err, req, res, next) => {
  console.error("--- Global Error Handler Caught Error ---"); // Prominent log
  console.error("Error Name:", err.name);
  console.error("Error Message:", err.message); // Log the error message
  console.error("Error Stack:", err.stack); // Log the stack trace
  console.error("Request Method:", req.method);
  console.error("Request Path:", req.path);
  console.error("Request Headers:", req.headers);
  console.error("--- End Global Error Handler ---");

  if (!res.headersSent) {
      res.status(err.status || 500).json({
          message: err.message || 'An unexpected error occurred',
          error: err.stack || 'No stack trace available'
      });
  }
});

app.get('/api/v1/health', (req, res) => {
  res.status(200).json({ status: 'OK', server: 'travelai', uptime: process.uptime() });
});

app.listen(PORT, () => {
    console.log(`The server is running on port ${PORT}`);
});
