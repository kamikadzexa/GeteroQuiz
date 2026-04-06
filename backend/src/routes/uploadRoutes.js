const express = require('express');
const multer = require('multer');
const path = require('path');
const { uploadFile } = require('../controllers/uploadController');
const { requireAdmin } = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, path.join(__dirname, '../../uploads'));
  },
  filename: (_req, file, callback) => {
    const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const extension = path.extname(file.originalname);
    callback(null, `${stamp}${extension}`);
  },
});

const upload = multer({ storage });
const router = express.Router();

router.post('/avatar', upload.single('file'), uploadFile);
router.post('/media', requireAdmin, upload.single('file'), uploadFile);

module.exports = router;
