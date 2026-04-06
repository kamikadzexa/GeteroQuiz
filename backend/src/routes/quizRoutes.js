const express = require('express');
const multer = require('multer');
const {
  listQuizzes,
  getQuiz,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  uploadQuizMedia,
  exportQuiz,
  importQuiz,
} = require('../controllers/quizController');
const { getMaxUploadSizeBytes } = require('../config/uploadConfig');
const { prepareQuizMediaUpload } = require('../services/quizStorageService');
const { requireStaff } = require('../middleware/auth');
const { uploadLimitHandler } = require('../middleware/uploadLimit');

const router = express.Router();
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: getMaxUploadSizeBytes(),
  },
});
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, callback) => {
      try {
        const target = await prepareQuizMediaUpload(req.params.quizId, file.originalname);
        req.quizMediaUpload = target;
        callback(null, target.mediaDirectory);
      } catch (error) {
        callback(error);
      }
    },
    filename: (req, _file, callback) => {
      callback(null, req.quizMediaUpload.filename);
    },
  }),
  limits: {
    fileSize: getMaxUploadSizeBytes(),
  },
});

router.use(requireStaff);
router.get('/', listQuizzes);
router.post('/', createQuiz);
router.post('/import', importUpload.single('file'), importQuiz);
router.get('/:quizId', getQuiz);
router.put('/:quizId', updateQuiz);
router.delete('/:quizId', deleteQuiz);
router.get('/:quizId/export', exportQuiz);
router.post('/:quizId/media', mediaUpload.single('file'), uploadQuizMedia);
router.post('/:quizId/questions', createQuestion);
router.put('/:quizId/questions/:questionId', updateQuestion);
router.delete('/:quizId/questions/:questionId', deleteQuestion);
router.use(uploadLimitHandler);

module.exports = router;
