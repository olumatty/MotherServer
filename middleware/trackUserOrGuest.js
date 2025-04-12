const { v4: uuidv4 } = require('uuid');

const trackUserOrGuest = (req, res, next) => {
    if (!req.isAuthenticated) { 
        if (!req.session.guestId) {
            req.session.guestId = uuidv4();
            console.log(`Guest session created: ${req.session.guestId}`);
        } else {
            console.log(`Returning guest: ${req.session.guestId}`);
        }
    } else {
        console.log(`Authenticated user: ${req.session.userId}`);
      
        delete req.session.guestId;
    }
    next();
}
module.exports = trackUserOrGuest;