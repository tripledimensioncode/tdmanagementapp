// Security headers, password policy, and authorization helpers

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required.' };
  }
  if (password.length < 12) {
    return { valid: false, message: 'Password must be at least 12 characters long.' };
  }
  return { valid: true };
}

function isOwnerOrAdmin(user, authorId) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  return Number(user.id) === Number(authorId);
}

module.exports = {
  securityHeaders,
  validatePassword,
  isOwnerOrAdmin
};
