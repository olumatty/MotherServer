const uuid = require('uuid');
const uuidv4 = uuid.v4;
console.log('uuid package:', require('uuid')); // Log the entire imported object

const trackUserOrGuest = (req, res, next) => {
    if (!req.session.isAuthenticated) {
        if (!req.session.guestId) {
            console.log('uuidv4 function:', uuidv4); // Log the function itself
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
};

module.exports = trackUserOrGuest;