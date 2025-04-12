const authCheck = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ message:"Please login to access this service" });
    }
};

module.exports = authCheck;