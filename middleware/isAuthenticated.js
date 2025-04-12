const isAuthenticated = (req, res, next) => {
    if (!req.session.userId) {
        req.isAuthenticated = true;
        console.log(`Guest session created: ${req.session.userId}`);
    }else{
        req.isAuthenticated = false;
    }

    next(); // Always proceed
};

module.exports = isAuthenticated;