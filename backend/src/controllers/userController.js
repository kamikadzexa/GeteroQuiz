const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User } = require('../models');

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

async function ensureNotRemovingLastAdmin(userId, nextRole, nextStatus) {
  if (nextRole === 'admin' && nextStatus === 'active') {
    return;
  }

  const activeAdminCount = await User.count({
    where: {
      id: { [Op.ne]: userId },
      role: 'admin',
      status: 'active',
    },
  });

  if (activeAdminCount === 0) {
    throw new Error('At least one active admin must remain');
  }
}

async function listUsers(_req, res, next) {
  try {
    const users = await User.findAll({
      order: [
        ['role', 'DESC'],
        ['status', 'ASC'],
        ['createdAt', 'ASC'],
      ],
    });

    return res.json(users.map(serializeUser));
  } catch (error) {
    return next(error);
  }
}

async function updateUser(req, res, next) {
  try {
    const user = await User.findByPk(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const nextUsername = req.body.username == null ? user.username : String(req.body.username).trim();
    const nextDisplayName =
      req.body.displayName == null ? user.displayName : String(req.body.displayName).trim();
    const nextRole = req.body.role == null ? user.role : String(req.body.role);
    const nextStatus = req.body.status == null ? user.status : String(req.body.status);
    const nextPassword = req.body.password == null ? '' : String(req.body.password);

    if (!nextUsername || !nextDisplayName) {
      return res.status(400).json({ message: 'Username and display name are required' });
    }

    if (!['admin', 'editor'].includes(nextRole)) {
      return res.status(400).json({ message: 'Role is invalid' });
    }

    if (!['pending', 'active'].includes(nextStatus)) {
      return res.status(400).json({ message: 'Status is invalid' });
    }

    const duplicate = await User.findOne({
      where: {
        username: nextUsername,
        id: { [Op.ne]: user.id },
      },
    });

    if (duplicate) {
      return res.status(409).json({ message: 'That username is already taken' });
    }

    if (user.role === 'admin' && user.status === 'active') {
      await ensureNotRemovingLastAdmin(user.id, nextRole, nextStatus);
    }

    user.username = nextUsername;
    user.displayName = nextDisplayName;
    user.role = nextRole;
    user.status = nextStatus;

    if (nextPassword) {
      user.passwordHash = await bcrypt.hash(nextPassword, 10);
    }

    await user.save();
    return res.json(serializeUser(user));
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listUsers,
  updateUser,
};
