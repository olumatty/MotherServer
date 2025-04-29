const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
  console.log("--- authenticateToken middleware hit ---");
  console.log("Request path:", req.path); 
  console.log("Received cookies object:", req.cookies); 
  console.log("Received 'token' cookie value:", req.cookies ? req.cookies['token'] : 'Cookies object is null/undefined'); 

  let token = req.headers.authorization?.split(' ')[1];

  // Fallback to cookie if no header token
  if (!token && req.cookies?.token) {
    token = req.cookies.token;
     console.log("Using token from cookie."); 
      console.log("Using token from Authorization header."); 
  } else {
       console.log("Token not found in header or cookie."); 
  }
  if (!token) {
    console.log('No token provided, sending 401');
    return res.status(401).json({ message: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    console.log('Token decoded:', decoded); 
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

module.exports = authenticateToken;