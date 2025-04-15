const isAuthenticated = (req, res, next) => {
    console.log("Checking session in isAuthenticated:", req.session);
    if (!req.session.userId) {
        req.isAuthenticated = false;  // No userId means NOT authenticated
        console.log(`Guest session created: ${req.sessionID}`); // Log the sessionID instead
    } else {
        req.isAuthenticated = true;  // Has userId means IS authenticated
    }

    next(); // Always proceed
};

module.exports = isAuthenticated;