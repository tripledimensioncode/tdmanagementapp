// Simple flash middleware: stores messages in session and exposes in res.locals
module.exports = function () {
  return function (req, res, next) {
    if (!req.session) return next();
    res.locals.flash = req.session.flash || {};
    delete req.session.flash;
    next();
  };
};
