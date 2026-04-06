const jwt = require('jsonwebtoken');

function signAdminToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
    },
    process.env.JWT_SECRET || 'quiz-secret',
    { expiresIn: '7d' },
  );
}

function verifyAdminToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET || 'quiz-secret');
}

module.exports = {
  signAdminToken,
  verifyAdminToken,
};
