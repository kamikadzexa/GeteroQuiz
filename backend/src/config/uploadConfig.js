const DEFAULT_MAX_UPLOAD_SIZE_MB = 300;

function getMaxUploadSizeMb() {
  const parsed = Number(process.env.MAX_UPLOAD_SIZE_MB);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_MAX_UPLOAD_SIZE_MB;
}

function getMaxUploadSizeBytes() {
  return getMaxUploadSizeMb() * 1024 * 1024;
}

module.exports = {
  DEFAULT_MAX_UPLOAD_SIZE_MB,
  getMaxUploadSizeMb,
  getMaxUploadSizeBytes,
};
