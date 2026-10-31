const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Please sign in to continue.' });
  try {
    const verified = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.user = { id: verified.id, role: verified.role, name: verified.name, email: verified.email };
    return next();
  } catch {
    return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    next();
  };
}

module.exports = auth;
module.exports.requireRole = requireRole;
