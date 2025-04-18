// server.js
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
// CORS configuration that allows credentials
app.use(
  cors({
    origin: 'http://localhost:5173',
    credentials: true, // This is crucial for cookies/sessions!
  })
);



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


