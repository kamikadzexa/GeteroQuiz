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
const { requireStaff } = require('../middleware/auth');
const { uploadLimitHandler } = require('../middleware/uploadLimit');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: getMaxUploadSizeBytes(),
  },
});

router.use(requireStaff);
router.get('/', listQuizzes);
router.post('/', createQuiz);
router.post('/import', upload.single('file'), importQuiz);
router.get('/:quizId', getQuiz);
router.put('/:quizId', updateQuiz);
router.delete('/:quizId', deleteQuiz);
router.get('/:quizId/export', exportQuiz);
router.post('/:quizId/media', upload.single('file'), uploadQuizMedia);
router.post('/:quizId/questions', createQuestion);
router.put('/:quizId/questions/:questionId', updateQuestion);
router.delete('/:quizId/questions/:questionId', deleteQuestion);
router.use(uploadLimitHandler);

module.exports = router;
