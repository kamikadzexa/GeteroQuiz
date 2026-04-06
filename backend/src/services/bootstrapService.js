const bcrypt = require('bcryptjs');
const { User, Quiz, Question } = require('../models');
const { syncQuizStorage } = require('./quizStorageService');

async function ensureDefaultData() {
  if ((await User.count()) === 0 && process.env.SEED_DEFAULT_ADMIN === 'true') {
    await User.create({
      username: process.env.ADMIN_USERNAME || 'admin',
      displayName: process.env.ADMIN_DISPLAY_NAME || 'Quiz Host',
      passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'party1234', 10),
      role: 'admin',
      status: 'active',
    });
  }

  let quiz = await Quiz.findOne({
    where: { title: 'Friday Party Mix' },
  });

  if (!quiz && (await Quiz.count()) === 0) {
    quiz = await Quiz.create({
      title: 'Friday Party Mix',
      description: 'A demo quiz with both classic and media-ready questions.',
      mode: 'classic',
      accentColor: '#ff7a59',
      isPublished: true,
    });
  }

  if (quiz && (await Question.count({ where: { quizId: quiz.id } })) === 0) {
    await Question.bulkCreate([
      {
        quizId: quiz.id,
        order: 0,
        type: 'multiple_choice',
        prompt: 'Which city is known as the City of Canals?',
        helpText: 'A warm-up question for the room.',
        options: [
          { id: 'A', text: 'Venice' },
          { id: 'B', text: 'Prague' },
          { id: 'C', text: 'Amsterdam' },
          { id: 'D', text: 'Lisbon' },
        ],
        correctAnswer: 'A',
        timeLimitSeconds: 20,
        points: 100,
        penaltyPoints: 40,
      },
      {
        quizId: quiz.id,
        order: 1,
        type: 'text',
        prompt: 'Name the artist behind the album "Future Nostalgia".',
        helpText: 'Text questions are reviewed by the admin.',
        correctAnswer: 'Dua Lipa',
        timeLimitSeconds: 25,
        points: 150,
        penaltyPoints: 50,
      },
      {
        quizId: quiz.id,
        order: 2,
        type: 'multiple_choice',
        prompt: 'Pick the snack that is traditionally made from chickpeas.',
        options: [
          { id: 'A', text: 'Falafel' },
          { id: 'B', text: 'Kimchi' },
          { id: 'C', text: 'Gelato' },
          { id: 'D', text: 'Pierogi' },
        ],
        correctAnswer: 'A',
        timeLimitSeconds: 20,
        points: 100,
        penaltyPoints: 40,
      },
    ]);
  }

  if (quiz) {
    await syncQuizStorage(quiz.id);
  }
}

module.exports = {
  ensureDefaultData,
};
