const express = require('express');
const { listUsers, updateUser } = require('../controllers/userController');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAdmin);
router.get('/', listUsers);
router.put('/:userId', updateUser);

module.exports = router;
