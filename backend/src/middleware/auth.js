const { verifyAdminToken } = require('../services/authService');
const { User } = require('../models');

function extractToken(req) {
  const authorization = req.headers.authorization || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
}

async function requireStaff(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ message: 'Authorization token is missing' });
  }

  try {
    const payload = verifyAdminToken(token);
    const user = await User.findByPk(payload.sub);
    if (!user) {
      return res.status(401).json({ message: 'Authorization token is invalid' });
    }

    req.admin = {
      sub: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
    };

    if (user.status !== 'active' || !['admin', 'editor'].includes(user.role)) {
      return res.status(403).json({ message: 'Your account does not have access yet' });
    }
    return next();
  } catch (_error) {
    return res.status(401).json({ message: 'Authorization token is invalid' });
  }
}

function requireAdmin(req, res, next) {
  return requireStaff(req, res, () => {
    if (req.admin.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access is required' });
    }

    return next();
  });
}

module.exports = {
  requireStaff,
  requireAdmin,
};
