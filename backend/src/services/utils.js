function createJoinCode(length = 5) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function createRejoinCode(length = 4) {
  const digits = '0123456789';
  return Array.from({ length }, () => digits[Math.floor(Math.random() * digits.length)]).join('');
}

function normalizeAnswer(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function sanitizeQuestion(question, phase) {
  const base = {
    id: question.id,
    prompt: question.prompt,
    helpText: question.helpText,
    type: question.type,
    order: question.order,
    options: question.options ?? [],
    mediaType: question.mediaType,
    mediaUrl: question.mediaUrl,
    mediaVersion: question.mediaVersion ?? null,
    timeLimitSeconds: question.timeLimitSeconds,
    points: question.points,
    penaltyPoints: question.penaltyPoints,
  };

  if (phase === 'review' || phase === 'finished') {
    return {
      ...base,
      correctAnswer: question.correctAnswer,
    };
  }

  return base;
}

module.exports = {
  createJoinCode,
  createRejoinCode,
  normalizeAnswer,
  sanitizeQuestion,
};
