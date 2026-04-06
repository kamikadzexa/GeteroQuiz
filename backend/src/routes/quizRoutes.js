const express = require('express');
const multer = require('multer');
const {
  listQuizzes,
  getQuiz,
  createQuiz,
  updateQuiz,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  uploadQuizMedia,
  exportQuiz,
  importQuiz,
} = require('../controllers/quizController');
const { requireStaff } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireStaff);
router.get('/', listQuizzes);
router.post('/', createQuiz);
router.post('/import', upload.single('file'), importQuiz);
router.get('/:quizId', getQuiz);
router.put('/:quizId', updateQuiz);
router.get('/:quizId/export', exportQuiz);
router.post('/:quizId/media', upload.single('file'), uploadQuizMedia);
router.post('/:quizId/questions', createQuestion);
router.put('/:quizId/questions/:questionId', updateQuestion);
router.delete('/:quizId/questions/:questionId', deleteQuestion);

module.exports = router;
