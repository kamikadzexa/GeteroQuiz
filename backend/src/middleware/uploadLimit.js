const multer = require('multer');
const { getMaxUploadSizeMb } = require('../config/uploadConfig');

function uploadLimitHandler(error, _req, res, next) {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      message: `File is too large. Maximum upload size is ${getMaxUploadSizeMb()} MB.`,
    });
  }

  return next(error);
}

module.exports = {
  uploadLimitHandler,
};
