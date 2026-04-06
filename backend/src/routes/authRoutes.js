const express = require('express');
const { login, register, me } = require('../controllers/authController');
const { requireStaff } = require('../middleware/auth');

const router = express.Router();

router.post('/login', login);
router.post('/register', register);
router.get('/me', requireStaff, me);

module.exports = router;
