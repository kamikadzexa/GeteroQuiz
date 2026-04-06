const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../../data/quiz.sqlite'),
  logging: false,
});

const User = require('./user')(sequelize, DataTypes);
const Quiz = require('./quiz')(sequelize, DataTypes);
const Question = require('./question')(sequelize, DataTypes);
const GameSession = require('./gameSession')(sequelize, DataTypes);
const Player = require('./player')(sequelize, DataTypes);
const Answer = require('./answer')(sequelize, DataTypes);
const Score = require('./score')(sequelize, DataTypes);

Quiz.hasMany(Question, { as: 'questions', foreignKey: 'quizId', onDelete: 'CASCADE' });
Question.belongsTo(Quiz, { as: 'quiz', foreignKey: 'quizId' });

Quiz.hasMany(GameSession, { as: 'sessions', foreignKey: 'quizId', onDelete: 'CASCADE' });
GameSession.belongsTo(Quiz, { as: 'quiz', foreignKey: 'quizId' });

GameSession.hasMany(Player, { as: 'players', foreignKey: 'sessionId', onDelete: 'CASCADE' });
Player.belongsTo(GameSession, { as: 'session', foreignKey: 'sessionId' });

GameSession.hasMany(Answer, { as: 'answers', foreignKey: 'sessionId', onDelete: 'CASCADE' });
Answer.belongsTo(GameSession, { as: 'session', foreignKey: 'sessionId' });

Player.hasMany(Answer, { as: 'answers', foreignKey: 'playerId', onDelete: 'CASCADE' });
Answer.belongsTo(Player, { as: 'player', foreignKey: 'playerId' });

Question.hasMany(Answer, { as: 'answers', foreignKey: 'questionId', onDelete: 'CASCADE' });
Answer.belongsTo(Question, { as: 'question', foreignKey: 'questionId' });

GameSession.hasMany(Score, { as: 'scores', foreignKey: 'sessionId', onDelete: 'CASCADE' });
Score.belongsTo(GameSession, { as: 'session', foreignKey: 'sessionId' });

Player.hasMany(Score, { as: 'scores', foreignKey: 'playerId', onDelete: 'CASCADE' });
Score.belongsTo(Player, { as: 'player', foreignKey: 'playerId' });

module.exports = {
  sequelize,
  User,
  Quiz,
  Question,
  GameSession,
  Player,
  Answer,
  Score,
};
