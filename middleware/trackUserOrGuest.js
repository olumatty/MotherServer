const { v4: uuidv4 } = require('uuid');
const trackUserOrGuest = (req, res, next) => {
    // Check if this session exists before doing anything
    if (!req.session) {
        console.log("No session found!");
        return next();
    }
    
    if (req.session.isAuthenticated) {
        console.log(`Authenticated user: ${req.session.userId}`);
        // If they were previously a guest, note the transition
        if (req.session.guestId) {
            console.log(`Guest ${req.session.guestId} is now authenticated as ${req.session.userId}`);
            delete req.session.guestId;
        }
    } else {
        // Not authenticated, ensure they have a guest ID
        if (!req.session.guestId) {
            req.session.guestId = uuidv4();
            console.log(`New guest session created: ${req.session.guestId}`);
        } else {
            console.log(`Returning guest: ${req.session.guestId}`);
        }
    }
    next();
};
module.exports = trackUserOrGuest;