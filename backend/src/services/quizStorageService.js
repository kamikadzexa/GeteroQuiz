const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { Quiz, Question } = require('../models');

const DATA_ROOT = path.join(__dirname, '../../data');
const QUIZZES_ROOT = path.join(DATA_ROOT, 'quizzes');

function ensureStorageRoots() {
  fs.mkdirSync(QUIZZES_ROOT, { recursive: true });
}

function slugify(value) {
  return String(value || 'quiz')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'quiz';
}

function sortQuestionsByRoundOrder(questions, boardLayout) {
  const layout = Array.isArray(boardLayout) ? boardLayout : [];
  const roundIndex = Object.fromEntries(layout.map((round, i) => [round.name, i]));
  const unassigned = layout.length;

  questions.sort((a, b) => {
    const ra = a.roundName ? (roundIndex[a.roundName] ?? unassigned) : unassigned;
    const rb = b.roundName ? (roundIndex[b.roundName] ?? unassigned) : unassigned;
    if (ra !== rb) return ra - rb;
    return a.order - b.order;
  });
}

async function loadQuizWithQuestions(quizId) {
  const quiz = await Quiz.findByPk(quizId, {
    include: [{ model: Question, as: 'questions' }],
  });

  if (!quiz) {
    return null;
  }

  sortQuestionsByRoundOrder(quiz.questions, quiz.boardLayout);
  return quiz;
}

async function ensureQuizStorageKey(quiz) {
  if (quiz.storageKey) {
    return quiz.storageKey;
  }

  const base = `${String(quiz.id).padStart(4, '0')}-${slugify(quiz.title)}`;
  let candidate = base;
  let suffix = 1;

  // Keep folder keys unique even if older rows already used the same key.
  while (
    (await Quiz.count({
      where: { storageKey: candidate },
    })) > 0
  ) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  await quiz.update({ storageKey: candidate });
  return candidate;
}

function getQuizDirectory(storageKey) {
  return path.join(QUIZZES_ROOT, storageKey);
}

function getQuizMediaDirectory(storageKey) {
  return path.join(getQuizDirectory(storageKey), 'media');
}

function getQuizPublicMediaPath(storageKey, filename) {
  return `/quiz-data/${storageKey}/media/${filename}`;
}

function isManagedQuizMediaUrl(storageKey, rawUrl) {
  return typeof rawUrl === 'string' && rawUrl.startsWith(`/quiz-data/${storageKey}/media/`);
}

function collectReferencedQuizMediaFilenames(quiz, storageKey) {
  const filenames = new Set();

  for (const question of quiz.questions) {
    [question.mediaUrl, question.correctAnswerMediaUrl].forEach((rawUrl) => {
      if (!isManagedQuizMediaUrl(storageKey, rawUrl)) return;
      filenames.add(path.basename(rawUrl));
    });
  }

  return filenames;
}

function pruneUnusedQuizMedia(quiz, storageKey) {
  const mediaDirectory = getQuizMediaDirectory(storageKey);
  if (!fs.existsSync(mediaDirectory)) return;

  const referenced = collectReferencedQuizMediaFilenames(quiz, storageKey);

  for (const entry of fs.readdirSync(mediaDirectory)) {
    if (referenced.has(entry)) continue;
    fs.rmSync(path.join(mediaDirectory, entry), { force: true, recursive: true });
  }
}

function sanitizeFilename(filename) {
  const extension = path.extname(filename || '');
  const stem = path
    .basename(filename || 'file', extension)
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${stem || 'file'}${extension}`;
}

function buildQuestionText(question, index) {
  const lines = [
    `Question ${index + 1}`,
    `Prompt: ${question.prompt}`,
    `Type: ${question.type}`,
    `Timer: ${question.timeLimitSeconds}s`,
    `Points: ${question.points}`,
    `Penalty: ${question.penaltyPoints}`,
  ];

  if (question.helpText) {
    lines.push(`Help: ${question.helpText}`);
  }

  if (Array.isArray(question.options) && question.options.length > 0) {
    lines.push('Options:');
    question.options.forEach((option) => {
      lines.push(`- ${option.id}: ${option.text}`);
    });
  }

  lines.push(`Correct answer: ${question.correctAnswer || '(empty)'}`);

  if (question.mediaType && question.mediaType !== 'none') {
    lines.push(`Media type: ${question.mediaType}`);
    lines.push(`Media: ${question.mediaUrl || '(missing)'}`);
  }

  return lines.join('\n');
}

function buildQuestionsText(quiz) {
  const header = [
    `Quiz: ${quiz.title}`,
    `Description: ${quiz.description || ''}`,
    `Mode: ${quiz.mode}`,
    `Accent color: ${quiz.accentColor}`,
    '',
  ];

  const body = quiz.questions.map((question, index) => buildQuestionText(question, index));
  return [...header, ...body].join('\n\n');
}

async function migrateLegacyMediaIntoQuizFolder(quiz) {
  const storageKey = await ensureQuizStorageKey(quiz);
  const mediaDirectory = getQuizMediaDirectory(storageKey);
  fs.mkdirSync(mediaDirectory, { recursive: true });

  for (const question of quiz.questions) {
    if (!question.mediaUrl || !question.mediaUrl.startsWith('/uploads/')) {
      continue;
    }

    const filename = path.basename(question.mediaUrl);
    const sourcePath = path.join(__dirname, '../../uploads', filename);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    let targetName = sanitizeFilename(filename);
    let targetPath = path.join(mediaDirectory, targetName);
    let copyIndex = 1;
    while (fs.existsSync(targetPath)) {
      const extension = path.extname(targetName);
      const stem = path.basename(targetName, extension);
      targetName = `${stem}-${copyIndex}${extension}`;
      targetPath = path.join(mediaDirectory, targetName);
      copyIndex += 1;
    }

    fs.copyFileSync(sourcePath, targetPath);
    await question.update({
      mediaUrl: getQuizPublicMediaPath(storageKey, targetName),
    });
  }
}

function buildQuizManifest(quiz, storageKey) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    storageKey,
    quiz: {
      title: quiz.title,
      description: quiz.description,
      mode: quiz.mode,
      accentColor: quiz.accentColor,
      isPublished: quiz.isPublished,
      editorPinHash: quiz.editorPinHash || null,
      questions: quiz.questions.map((question) => ({
        prompt: question.prompt,
        helpText: question.helpText,
        type: question.type,
        order: question.order,
        options: question.options,
        correctAnswer: question.correctAnswer,
        correctAnswerMediaType: question.correctAnswerMediaType,
        correctAnswerMediaUrl: question.correctAnswerMediaUrl,
        mediaType: question.mediaType,
        mediaUrl: question.mediaUrl,
        timeLimitSeconds: question.timeLimitSeconds,
        points: question.points,
        penaltyPoints: question.penaltyPoints,
        roundName: question.roundName,
        columnName: question.columnName,
        specialType: question.specialType,
      })),
      boardLayout: Array.isArray(quiz.boardLayout) ? quiz.boardLayout : [],
    },
  };
}

async function syncQuizStorage(quizId) {
  ensureStorageRoots();
  const quiz = await loadQuizWithQuestions(quizId);
  if (!quiz) {
    return null;
  }

  const storageKey = await ensureQuizStorageKey(quiz);
  await migrateLegacyMediaIntoQuizFolder(quiz);

  const reloadedQuiz = await loadQuizWithQuestions(quizId);
  const quizDirectory = getQuizDirectory(storageKey);
  fs.mkdirSync(getQuizMediaDirectory(storageKey), { recursive: true });
  pruneUnusedQuizMedia(reloadedQuiz, storageKey);

  fs.writeFileSync(
    path.join(quizDirectory, 'quiz.json'),
    JSON.stringify(buildQuizManifest(reloadedQuiz, storageKey), null, 2),
    'utf8',
  );
  fs.writeFileSync(path.join(quizDirectory, 'questions.txt'), buildQuestionsText(reloadedQuiz), 'utf8');

  return reloadedQuiz;
}

async function ensureAllQuizStorage() {
  ensureStorageRoots();
  const quizzes = await Quiz.findAll();
  for (const quiz of quizzes) {
    await syncQuizStorage(quiz.id);
  }
}

async function saveUploadedQuizMedia(quizId, file) {
  ensureStorageRoots();
  const quiz = await Quiz.findByPk(quizId);
  if (!quiz) {
    throw new Error('Quiz not found');
  }

  const storageKey = await ensureQuizStorageKey(quiz);
  const mediaDirectory = getQuizMediaDirectory(storageKey);
  fs.mkdirSync(mediaDirectory, { recursive: true });

  const baseName = `${Date.now()}-${sanitizeFilename(file.originalname)}`;
  const targetPath = path.join(mediaDirectory, baseName);
  fs.writeFileSync(targetPath, file.buffer);

  return {
    storageKey,
    filename: baseName,
    absolutePath: targetPath,
    url: getQuizPublicMediaPath(storageKey, baseName),
    mimeType: file.mimetype,
  };
}

async function prepareQuizMediaUpload(quizId, originalname) {
  ensureStorageRoots();
  const quiz = await Quiz.findByPk(quizId);
  if (!quiz) {
    throw new Error('Quiz not found');
  }

  const storageKey = await ensureQuizStorageKey(quiz);
  const mediaDirectory = getQuizMediaDirectory(storageKey);
  fs.mkdirSync(mediaDirectory, { recursive: true });

  const filename = `${Date.now()}-${sanitizeFilename(originalname)}`;

  return {
    storageKey,
    mediaDirectory,
    filename,
    absolutePath: path.join(mediaDirectory, filename),
    url: getQuizPublicMediaPath(storageKey, filename),
  };
}

async function createQuizExportArchive(quizId) {
  const quiz = await syncQuizStorage(quizId);
  if (!quiz) {
    return null;
  }

  const storageKey = await ensureQuizStorageKey(quiz);
  const quizDirectory = getQuizDirectory(storageKey);
  const archive = new AdmZip();
  archive.addLocalFolder(quizDirectory, storageKey);

  return {
    filename: `${storageKey}.zip`,
    buffer: archive.toBuffer(),
  };
}

function deleteQuizStorage(storageKey) {
  if (!storageKey) {
    return;
  }

  ensureStorageRoots();
  const rootDirectory = path.resolve(QUIZZES_ROOT);
  const quizDirectory = path.resolve(getQuizDirectory(storageKey));

  if (!quizDirectory.startsWith(`${rootDirectory}${path.sep}`)) {
    return;
  }

  fs.rmSync(quizDirectory, { recursive: true, force: true });
}

function normalizeImportedMediaUrl(rawUrl, storageKey) {
  if (!rawUrl) {
    return '';
  }

  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    return rawUrl;
  }

  const filename = path.basename(rawUrl);
  return getQuizPublicMediaPath(storageKey, filename);
}

async function importQuizArchive(buffer) {
  ensureStorageRoots();
  const archive = new AdmZip(buffer);
  const manifestEntry = archive
    .getEntries()
    .find((entry) => path.basename(entry.entryName).toLowerCase() === 'quiz.json');

  if (!manifestEntry) {
    throw new Error('The ZIP file must contain quiz.json');
  }

  const manifest = JSON.parse(archive.readAsText(manifestEntry));
  const sourceQuiz = manifest?.quiz;
  if (!sourceQuiz || !sourceQuiz.title || !Array.isArray(sourceQuiz.questions)) {
    throw new Error('quiz.json is missing quiz details');
  }

  const createdQuiz = await Quiz.create({
    title: sourceQuiz.title,
    description: sourceQuiz.description || '',
    mode: sourceQuiz.mode || 'classic',
    accentColor: sourceQuiz.accentColor || '#ff6b6b',
    isPublished: sourceQuiz.isPublished ?? true,
    editorPinHash: sourceQuiz.editorPinHash || null,
    boardLayout: Array.isArray(sourceQuiz.boardLayout) ? sourceQuiz.boardLayout : [],
  });

  const storageKey = await ensureQuizStorageKey(createdQuiz);
  const quizDirectory = getQuizDirectory(storageKey);
  const mediaDirectory = getQuizMediaDirectory(storageKey);
  fs.mkdirSync(mediaDirectory, { recursive: true });

  archive.getEntries().forEach((entry) => {
    if (entry.isDirectory) {
      return;
    }

    const normalized = entry.entryName.replace(/\\/g, '/');
    if (!normalized.includes('/media/')) {
      return;
    }

    const filename = path.basename(normalized);
    fs.writeFileSync(path.join(mediaDirectory, filename), entry.getData());
  });

  await Question.bulkCreate(
    sourceQuiz.questions.map((question, index) => ({
      quizId: createdQuiz.id,
      prompt: question.prompt,
      helpText: question.helpText || '',
      type: question.type || 'multiple_choice',
      order: question.order ?? index,
      options: Array.isArray(question.options) ? question.options : [],
      correctAnswer: question.correctAnswer || '',
      correctAnswerMediaType: question.correctAnswerMediaType || 'none',
      correctAnswerMediaUrl: normalizeImportedMediaUrl(question.correctAnswerMediaUrl || '', storageKey),
      mediaType: question.mediaType || 'none',
      mediaUrl: normalizeImportedMediaUrl(question.mediaUrl || '', storageKey),
      timeLimitSeconds: Number(question.timeLimitSeconds ?? 20),
      points: Number(question.points ?? 100),
      penaltyPoints: Number(question.penaltyPoints ?? 50),
      roundName: question.roundName || '',
      columnName: question.columnName || '',
      specialType: question.specialType || 'normal',
    })),
  );

  return syncQuizStorage(createdQuiz.id);
}

module.exports = {
  ensureAllQuizStorage,
  ensureQuizStorageKey,
  createQuizExportArchive,
  deleteQuizStorage,
  importQuizArchive,
  loadQuizWithQuestions,
  prepareQuizMediaUpload,
  saveUploadedQuizMedia,
  sortQuestionsByRoundOrder,
  syncQuizStorage,
};
