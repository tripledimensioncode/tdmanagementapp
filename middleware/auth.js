// Authentication middleware helpers
// Exports isLoggedIn and isAdmin for route protection

module.exports.isLoggedIn = function (req, res, next) {
  if (req.session && req.session.user) return next();
  req.session.flash = { error: 'Please log in to continue.' };
  return res.redirect('/auth/login');
};

module.exports.isAdmin = function (req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'ADMIN') return next();
  req.session.flash = { error: 'Admin access required.' };
  return res.redirect('/');
};
