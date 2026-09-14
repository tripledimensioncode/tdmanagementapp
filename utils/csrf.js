const crypto = require('crypto');

/**
 * Session-backed CSRF protection middleware replacing deprecated csurf.
 */
function csrf() {
  return function (req, res, next) {
    if (!req.session) {
      return next(new Error('CSRF middleware requires session support. Ensure express-session is initialized first.'));
    }

    if (!req.session.csrfSecret) {
      req.session.csrfSecret = crypto.randomBytes(32).toString('hex');
    }

    req.csrfToken = function () {
      return req.session.csrfSecret;
    };

    // Safe HTTP methods do not require CSRF validation
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
      return next();
    }

    const token =
      (req.body && req.body._csrf) ||
      (req.query && req.query._csrf) ||
      req.headers['x-csrf-token'] ||
      req.headers['x-xsrf-token'] ||
      req.headers['csrf-token'];

    if (!token || token !== req.session.csrfSecret) {
      const error = new Error('Invalid or missing CSRF token.');
      error.code = 'EBADCSRFTOKEN';
      error.status = 403;
      return next(error);
    }

    next();
  };
}

module.exports = csrf;
