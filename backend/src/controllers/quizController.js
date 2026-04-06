const {
  createQuizExportArchive,
  deleteQuizStorage,
  importQuizArchive,
  saveUploadedQuizMedia,
  syncQuizStorage,
} = require('../services/quizStorageService');
const { Quiz, Question } = require('../models');

async function listQuizzes(_req, res, next) {
  try {
    const quizzes = await Quiz.findAll({ order: [['createdAt', 'DESC']] });

    return res.json(
      await Promise.all(
        quizzes.map(async (quiz) => {
          const hydratedQuiz = await syncQuizStorage(quiz.id);
          return {
            id: hydratedQuiz.id,
            title: hydratedQuiz.title,
            description: hydratedQuiz.description,
            mode: hydratedQuiz.mode,
            accentColor: hydratedQuiz.accentColor,
            isPublished: hydratedQuiz.isPublished,
            questionCount: hydratedQuiz.questions.length,
            updatedAt: hydratedQuiz.updatedAt,
          };
        }),
      ),
    );
  } catch (error) {
    return next(error);
  }
}

async function getQuiz(req, res, next) {
  try {
    const quiz = await syncQuizStorage(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    return res.json(quiz);
  } catch (error) {
    return next(error);
  }
}

async function createQuiz(req, res, next) {
  try {
    const quiz = await Quiz.create({
      title: req.body.title,
      description: req.body.description || '',
      mode: req.body.mode || 'classic',
      accentColor: req.body.accentColor || '#ff6b6b',
      isPublished: req.body.isPublished ?? true,
    });

    const createdQuiz = await syncQuizStorage(quiz.id);
    return res.status(201).json(createdQuiz);
  } catch (error) {
    return next(error);
  }
}

async function updateQuiz(req, res, next) {
  try {
    const quiz = await Quiz.findByPk(req.params.quizId);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    await quiz.update({
      title: req.body.title ?? quiz.title,
      description: req.body.description ?? quiz.description,
      mode: req.body.mode ?? quiz.mode,
      accentColor: req.body.accentColor ?? quiz.accentColor,
      isPublished: req.body.isPublished ?? quiz.isPublished,
    });

    const updatedQuiz = await syncQuizStorage(req.params.quizId);

    if (!updatedQuiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    return res.json(updatedQuiz);
  } catch (error) {
    return next(error);
  }
}

async function deleteQuiz(req, res, next) {
  try {
    const quiz = await Quiz.findByPk(req.params.quizId);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    await req.app.locals.runtimeService.deleteSessionsForQuiz(quiz.id);
    const { storageKey } = quiz;
    await quiz.destroy();
    deleteQuizStorage(storageKey);

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
}

async function createQuestion(req, res, next) {
  try {
    const quiz = await Quiz.findByPk(req.params.quizId);
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const question = await Question.create({
      quizId: quiz.id,
      prompt: req.body.prompt,
      helpText: req.body.helpText || '',
      type: req.body.type || 'multiple_choice',
      order: req.body.order ?? 0,
      options: req.body.options || [],
      correctAnswer: req.body.correctAnswer || '',
      mediaType: req.body.mediaType || 'none',
      mediaUrl: req.body.mediaUrl || '',
      timeLimitSeconds: req.body.timeLimitSeconds ?? 20,
      points: req.body.points ?? 100,
      penaltyPoints: req.body.penaltyPoints ?? 50,
    });

    await syncQuizStorage(quiz.id);
    return res.status(201).json(question);
  } catch (error) {
    return next(error);
  }
}

async function updateQuestion(req, res, next) {
  try {
    const question = await Question.findByPk(req.params.questionId);
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }

    await question.update({
      prompt: req.body.prompt ?? question.prompt,
      helpText: req.body.helpText ?? question.helpText,
      type: req.body.type ?? question.type,
      order: req.body.order ?? question.order,
      options: req.body.options ?? question.options,
      correctAnswer: req.body.correctAnswer ?? question.correctAnswer,
      mediaType: req.body.mediaType ?? question.mediaType,
      mediaUrl: req.body.mediaUrl ?? question.mediaUrl,
      timeLimitSeconds: req.body.timeLimitSeconds ?? question.timeLimitSeconds,
      points: req.body.points ?? question.points,
      penaltyPoints: req.body.penaltyPoints ?? question.penaltyPoints,
    });

    await syncQuizStorage(question.quizId);
    return res.json(question);
  } catch (error) {
    return next(error);
  }
}

async function deleteQuestion(req, res, next) {
  try {
    const question = await Question.findByPk(req.params.questionId);
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }

    const quizId = question.quizId;
    await question.destroy();
    await syncQuizStorage(quizId);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
}

async function uploadQuizMedia(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file was uploaded' });
    }

    const upload = req.quizMediaUpload || await saveUploadedQuizMedia(req.params.quizId, req.file);
    await syncQuizStorage(req.params.quizId);

    return res.status(201).json({
      filename: upload.filename,
      originalName: req.file.originalname,
      url: upload.url,
      mimeType: upload.mimeType,
    });
  } catch (error) {
    return next(error);
  }
}

async function exportQuiz(req, res, next) {
  try {
    const archive = await createQuizExportArchive(req.params.quizId);
    if (!archive) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archive.filename}"`);
    return res.send(archive.buffer);
  } catch (error) {
    return next(error);
  }
}

async function importQuiz(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No ZIP file was uploaded' });
    }

    const quiz = await importQuizArchive(req.file.buffer);
    return res.status(201).json(quiz);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
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
};
