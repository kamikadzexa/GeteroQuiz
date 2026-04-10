const bcrypt = require('bcryptjs');
const { GameSession, Quiz } = require('../models');

function normalizeQuizPin(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : '';
}

function extractQuizPin(req) {
  const headerPin = req.headers['x-quiz-pin'];
  if (typeof headerPin === 'string') {
    return headerPin.trim();
  }

  if (Array.isArray(headerPin)) {
    return String(headerPin[0] || '').trim();
  }

  if (typeof req.body?.quizPin === 'string') {
    return req.body.quizPin.trim();
  }

  return '';
}

async function buildEditorPinHash(editorPin) {
  const normalized = normalizeQuizPin(editorPin);
  if (normalized === null) {
    return undefined;
  }

  if (normalized === '') {
    return null;
  }

  return bcrypt.hash(normalized, 10);
}

function quizHasEditorPin(quiz) {
  return Boolean(quiz?.editorPinHash);
}

async function assertQuizPinAccess(req, quiz) {
  if (!quizHasEditorPin(quiz)) {
    return;
  }

  // Authenticated admins and editors bypass the quiz PIN entirely
  if (req.admin) {
    return;
  }

  const candidatePin = extractQuizPin(req);
  if (!candidatePin) {
    const error = new Error('Quiz PIN is required');
    error.status = 403;
    throw error;
  }

  const isValid = await bcrypt.compare(candidatePin, quiz.editorPinHash);
  if (!isValid) {
    const error = new Error('Quiz PIN is invalid');
    error.status = 403;
    throw error;
  }
}

async function getQuizForRequest(req, quizId) {
  const quiz = await Quiz.findByPk(quizId);
  if (!quiz) {
    const error = new Error('Quiz not found');
    error.status = 404;
    throw error;
  }

  await assertQuizPinAccess(req, quiz);
  return quiz;
}

async function getSessionQuizForRequest(req, sessionId) {
  const session = await GameSession.findByPk(sessionId, {
    include: [{ model: Quiz, as: 'quiz' }],
  });

  if (!session || !session.quiz) {
    const error = new Error('Session not found');
    error.status = 404;
    throw error;
  }

  await assertQuizPinAccess(req, session.quiz);
  return session;
}

module.exports = {
  assertQuizPinAccess,
  buildEditorPinHash,
  extractQuizPin,
  getQuizForRequest,
  getSessionQuizForRequest,
  normalizeQuizPin,
  quizHasEditorPin,
};
