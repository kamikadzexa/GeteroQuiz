async function uploadFile(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: 'No file was uploaded' });
  }

  return res.status(201).json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
    mimeType: req.file.mimetype,
  });
}

module.exports = {
  uploadFile,
};
