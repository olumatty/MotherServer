const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
  // Check Authorization header first
  let token = req.headers.authorization?.split(' ')[1];

  // Fallback to cookie if no header token
  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    console.log('Token decoded:', decoded); // Debug payload
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

module.exports = authenticateToken;