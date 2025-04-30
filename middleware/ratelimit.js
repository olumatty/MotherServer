// rateLimit.js
const rateLimitStore = {};

// Window settings
const LIMIT = 15;
const WINDOW_MS = 60 * 60 * 1000;

function cleanupOldRequests(ip) {
  const now = Date.now();
  if (rateLimitStore[ip]) {
    // Filter out calls older than the window
    rateLimitStore[ip] = rateLimitStore[ip].filter(timestamp => now - timestamp < WINDOW_MS);
  }
}

function isRateLimited(ip) {
  // Skip rate limiting for local requests
  const localIps = ['127.0.0.1', '::1']; // Check for localhost IPs
  if (localIps.includes(ip)) return false;

  // Clean up expired entries
  cleanupOldRequests(ip);

  // Check if the IP has made too many requests
  return rateLimitStore[ip] && rateLimitStore[ip].length >= LIMIT;
}

function trackRequest(ip) {
  // Skip tracking for local requests
  const localIps = ['127.0.0.1', '::1']; // Check for localhost IPs
  if (localIps.includes(ip)) return;

  const now = Date.now();
  
  // Initialize or add to existing IP tracking
  if (!rateLimitStore[ip]) {
    rateLimitStore[ip] = [now];
  } else {
    rateLimitStore[ip].push(now);
  }
}

// Express middleware
function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
  
  // Check if rate limited
  if (isRateLimited(ip)) {
    res.setHeader('Retry-After', Math.ceil(WINDOW_MS / 1000 / 60)); // Retry-After header in minutes
    return res.status(429).json({ 
      error: 'Too many requests', 
      retryAfter: Math.ceil(WINDOW_MS / 1000 / 60) // minutes
    });
  }
  
  // Track this request
  trackRequest(ip);
  next();
}

// Periodically clean up the rate limit store to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  Object.keys(rateLimitStore).forEach(ip => {
    rateLimitStore[ip] = rateLimitStore[ip].filter(timestamp => now - timestamp < WINDOW_MS);
    
    // Remove empty arrays to save memory
    if (rateLimitStore[ip].length === 0) {
      delete rateLimitStore[ip];
    }
  });
}, 10 * 60 * 1000); // Clean up every 10 minutes

module.exports = {
  isRateLimited,
  trackRequest,
  rateLimitMiddleware
};
