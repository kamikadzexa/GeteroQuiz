const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { signAdminToken } = require('../services/authService');

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Your account is waiting for admin approval' });
    }

    return res.json({
      token: signAdminToken(user),
      user: serializeUser(user),
    });
  } catch (error) {
    return next(error);
  }
}

async function register(req, res, next) {
  try {
    const username = String(req.body.username || '').trim();
    const displayName = String(req.body.displayName || '').trim();
    const password = String(req.body.password || '');

    if (!username || !displayName || password.length < 4) {
      return res.status(400).json({ message: 'Username, display name, and password are required' });
    }

    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.status(409).json({ message: 'That username is already taken' });
    }

    const isFirstUser = (await User.count()) === 0;
    const user = await User.create({
      username,
      displayName,
      passwordHash: await bcrypt.hash(password, 10),
      role: isFirstUser ? 'admin' : 'editor',
      status: isFirstUser ? 'active' : 'pending',
    });

    return res.status(201).json({
      token: isFirstUser ? signAdminToken(user) : null,
      requiresApproval: !isFirstUser,
      user: serializeUser(user),
    });
  } catch (error) {
    return next(error);
  }
}

async function me(req, res, next) {
  try {
    const user = await User.findByPk(req.admin.sub);
    if (!user) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    return res.json(serializeUser(user));
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  login,
  register,
  me,
};
