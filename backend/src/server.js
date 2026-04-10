require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const http = require('http');
const cors = require('cors');
const express = require('express');
const { DataTypes } = require('sequelize');
const { Server } = require('socket.io');
const { sequelize } = require('./models');
const { SessionRuntimeService } = require('./services/sessionRuntimeService');
const { ensureDefaultData } = require('./services/bootstrapService');
const { ensureAllQuizStorage } = require('./services/quizStorageService');
const { registerSocketHandlers } = require('./sockets/registerSocketHandlers');
const authRoutes = require('./routes/authRoutes');
const quizRoutes = require('./routes/quizRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const userRoutes = require('./routes/userRoutes');
const { getMaxUploadSizeMb } = require('./config/uploadConfig');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

async function ensureQuestionColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const table = await queryInterface.describeTable('questions').catch(() => null);
  if (!table) return;

  const adds = [
    ['roundName', { type: DataTypes.STRING, allowNull: true, defaultValue: '' }],
    ['columnName', { type: DataTypes.STRING, allowNull: true, defaultValue: '' }],
    ['specialType', { type: DataTypes.STRING, allowNull: true, defaultValue: 'normal' }],
    ['correctAnswerMediaType', { type: DataTypes.STRING, allowNull: true, defaultValue: 'none' }],
    ['correctAnswerMediaUrl', { type: DataTypes.STRING, allowNull: true, defaultValue: '' }],
  ];

  for (const [col, def] of adds) {
    if (!table[col]) {
      await queryInterface.addColumn('questions', col, def);
    }
  }
}

async function ensureQuizStorageColumn() {
  const queryInterface = sequelize.getQueryInterface();
  const quizTable = await queryInterface.describeTable('quizzes').catch(() => null);

  if (!quizTable) {
    return;
  }

  if (!quizTable.storageKey) {
    await queryInterface.addColumn('quizzes', 'storageKey', {
      type: DataTypes.STRING,
      allowNull: true,
    });
  }

  if (!quizTable.boardLayout) {
    await queryInterface.addColumn('quizzes', 'boardLayout', {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    });
  }

  if (!quizTable.editorPinHash) {
    await queryInterface.addColumn('quizzes', 'editorPinHash', {
      type: DataTypes.STRING,
      allowNull: true,
    });
  }
}

async function startServer() {
  fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
  fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
  fs.mkdirSync(path.join(__dirname, '../data/quizzes'), { recursive: true });

  await sequelize.sync();
  await ensureQuizStorageColumn();
  await ensureQuestionColumns();
  await ensureDefaultData();
  await ensureAllQuizStorage();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || '*',
      credentials: true,
    },
  });

  const runtimeService = new SessionRuntimeService(io);
  app.locals.runtimeService = runtimeService;

  app.use(
    cors({
      origin: process.env.CORS_ORIGIN?.split(',') || '*',
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
  app.use('/quiz-data', express.static(path.join(__dirname, '../data/quizzes')));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/quizzes', quizRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/users', userRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  registerSocketHandlers(io, runtimeService);

  const port = Number(process.env.PORT || 4000);
  server.listen(port, () => {
    console.log(`Quiz backend listening on http://localhost:${port}`);
    console.log(`Maximum upload size: ${getMaxUploadSizeMb()} MB`);
    console.log('Register the first account in /admin to create the primary admin.');
  });
}

startServer().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
