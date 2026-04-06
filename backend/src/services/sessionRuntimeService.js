const { Op } = require('sequelize');
const { Answer, GameSession, Player, Question, Quiz, Score } = require('../models');
const { createJoinCode, createRejoinCode, normalizeAnswer, sanitizeQuestion } = require('./utils');

const AUTO_ANSWER_SECONDS = 60;
const AUTO_ADVANCE_SECONDS = 15;

class SessionRuntimeService {
  constructor(io) {
    this.io = io;
    this.runtime = new Map();
  }

  createRuntimeState(session = null) {
    return {
      phase: session?.phase ?? 'waiting',
      closesAt: null,
      timer: null,
      autoAdvanceAt: null,
      autoAdvanceTimer: null,
      autoAdvanceEnabled: true,
      autoAdvancePaused: false,
      autoAdvanceDurationSeconds: AUTO_ADVANCE_SECONDS,
      autoAdvanceRemainingSeconds: AUTO_ADVANCE_SECONDS,
      autoAdvanceAction: null,
      sessionAnswerDurationSeconds: AUTO_ANSWER_SECONDS,
      currentQuestionMediaVersion: null,
      currentBuzzPlayerId: null,
      buzzAttemptText: '',
      deniedBuzzPlayerIds: new Set(),
    };
  }

  getRoom(sessionId) {
    return `session:${sessionId}`;
  }

  getAdminRoom(sessionId) {
    return `session:${sessionId}:admins`;
  }

  async ensureJoinCode() {
    let joinCode = createJoinCode();
    while (await GameSession.findOne({ where: { joinCode } })) {
      joinCode = createJoinCode();
    }
    return joinCode;
  }

  async ensureRejoinCode(sessionId) {
    let rejoinCode = createRejoinCode();
    while (await Player.findOne({ where: { sessionId, rejoinCode } })) {
      rejoinCode = createRejoinCode();
    }
    return rejoinCode;
  }

  async ensureState(sessionId) {
    if (this.runtime.has(sessionId)) {
      return this.runtime.get(sessionId);
    }

    const session = await GameSession.findByPk(sessionId);
    const state = this.createRuntimeState(session);

    this.runtime.set(sessionId, state);
    return state;
  }

  clearTimer(state) {
    if (state?.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  clearAutoAdvanceTimer(state) {
    if (state?.autoAdvanceTimer) {
      clearTimeout(state.autoAdvanceTimer);
      state.autoAdvanceTimer = null;
    }
  }

  resetQuestionTimer(state) {
    this.clearTimer(state);
    state.closesAt = null;
  }

  resetAutoAdvanceSchedule(state, resetRemaining = true) {
    this.clearAutoAdvanceTimer(state);
    state.autoAdvanceAt = null;
    state.autoAdvanceAction = null;
    if (resetRemaining) {
      state.autoAdvanceRemainingSeconds = state.autoAdvanceDurationSeconds ?? AUTO_ADVANCE_SECONDS;
    }
  }

  getSecondsUntil(targetTime) {
    if (!targetTime) {
      return 0;
    }

    return Math.max(0, Math.ceil((new Date(targetTime).getTime() - Date.now()) / 1000));
  }

  refreshAutoAdvanceRemaining(state) {
    if (!state) {
      return 0;
    }

    if (state.autoAdvanceAt && !state.autoAdvancePaused) {
      state.autoAdvanceRemainingSeconds = this.getSecondsUntil(state.autoAdvanceAt);
    }

    return state.autoAdvanceRemainingSeconds;
  }

  getNextAutoAction(session) {
    if (
      !session ||
      session.status !== 'live' ||
      session.phase !== 'review' ||
      session.currentQuestionIndex < 0
    ) {
      return null;
    }

    return session.currentQuestionIndex < session.quiz.questions.length - 1 ? 'advance' : 'finish';
  }

  scheduleAutoAdvance(sessionId, state, action, remainingSeconds) {
    this.clearAutoAdvanceTimer(state);

    const safeRemainingSeconds = Math.max(
      1,
      Number(remainingSeconds || state.autoAdvanceDurationSeconds || AUTO_ADVANCE_SECONDS),
    );
    state.autoAdvanceAction = action;
    state.autoAdvancePaused = false;
    state.autoAdvanceRemainingSeconds = safeRemainingSeconds;
    state.autoAdvanceAt = new Date(Date.now() + safeRemainingSeconds * 1000).toISOString();
    state.autoAdvanceTimer = setTimeout(() => {
      const nextStep = action === 'finish' ? this.finishSession(sessionId) : this.advanceQuestion(sessionId);

      nextStep.catch((error) => {
        console.error('Failed to auto-advance session', error);
      });
    }, safeRemainingSeconds * 1000);
  }

  startQuestionTimer(sessionId, question, state) {
    this.resetQuestionTimer(state);

    const sessionAnswer = Number(state.sessionAnswerDurationSeconds ?? 0);
    const questionAnswer = Number(question?.timeLimitSeconds ?? 0);
    const durationSeconds = Math.max(0, sessionAnswer > 0 ? sessionAnswer : questionAnswer);
    if (durationSeconds <= 0) {
      return;
    }

    state.closesAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
    state.timer = setTimeout(() => {
      this.closeActiveQuestion(sessionId).catch((error) => {
        console.error('Failed to auto-close question', error);
      });
    }, durationSeconds * 1000);
  }

  async syncAutoAdvance(sessionId, session = null, { resetCountdown = false } = {}) {
    const state = await this.ensureState(sessionId);
    const graph = session ?? (await this.getSessionGraph(sessionId));
    const nextAction = this.getNextAutoAction(graph);

    this.refreshAutoAdvanceRemaining(state);

    if (!state.autoAdvanceEnabled) {
      this.clearAutoAdvanceTimer(state);
      state.autoAdvanceAt = null;
      state.autoAdvancePaused = false;
      state.autoAdvanceAction = nextAction;
      state.autoAdvanceRemainingSeconds = state.autoAdvanceDurationSeconds;
      return;
    }

    if (!nextAction) {
      this.clearAutoAdvanceTimer(state);
      state.autoAdvanceAt = null;
      state.autoAdvanceAction = null;
      state.autoAdvanceRemainingSeconds = state.autoAdvanceDurationSeconds;
      return;
    }

    const actionChanged = state.autoAdvanceAction !== nextAction;
    state.autoAdvanceAction = nextAction;

    if (
      resetCountdown ||
      actionChanged ||
      !state.autoAdvanceRemainingSeconds ||
      state.autoAdvanceRemainingSeconds < 1
    ) {
      state.autoAdvanceRemainingSeconds = state.autoAdvanceDurationSeconds;
    }

    if (state.autoAdvancePaused) {
      this.clearAutoAdvanceTimer(state);
      state.autoAdvanceAt = null;
      return;
    }

    this.scheduleAutoAdvance(sessionId, state, nextAction, state.autoAdvanceRemainingSeconds);
  }

  async getSessionGraph(sessionId) {
    const session = await GameSession.findByPk(sessionId, {
      include: [
        {
          model: Quiz,
          as: 'quiz',
          include: [{ model: Question, as: 'questions' }],
        },
        {
          model: Player,
          as: 'players',
          separate: true,
          order: [['createdAt', 'ASC']],
        },
        {
          model: Answer,
          as: 'answers',
          include: [
            { model: Player, as: 'player' },
            { model: Question, as: 'question' },
          ],
        },
        {
          model: Score,
          as: 'scores',
          include: [{ model: Player, as: 'player' }],
        },
      ],
    });

    if (!session) {
      throw new Error('Session not found');
    }

    session.quiz.questions.sort((left, right) => left.order - right.order);
    session.players.sort((left, right) => left.createdAt - right.createdAt);
    return session;
  }

  createLeaderboard(session) {
    const scoreMap = new Map(session.scores.map((score) => [score.playerId, score.points]));

    return session.players
      .map((player) => ({
        playerId: player.id,
        displayName: player.displayName,
        avatar: player.avatar,
        score: scoreMap.get(player.id) ?? 0,
        isConnected: player.isConnected,
      }))
      .sort((left, right) => right.score - left.score || left.displayName.localeCompare(right.displayName));
  }

  createPublicSessionSummary(session) {
    return {
      id: session.id,
      joinCode: session.joinCode,
      status: session.status,
      phase: session.phase,
      title: session.quiz.title,
      description: session.quiz.description,
      mode: session.quiz.mode,
      accentColor: session.quiz.accentColor,
      currentQuestionIndex: session.currentQuestionIndex,
      totalQuestions: session.quiz.questions.length,
      playerCount: session.players.length,
      connectedPlayerCount: session.players.filter((player) => player.isConnected).length,
    };
  }

  createQuestionReview(session, question) {
    if (!question) {
      return [];
    }

    return session.answers
      .filter((answer) => answer.questionId === question.id)
      .sort((left, right) => (left.buzzOrder ?? 9999) - (right.buzzOrder ?? 9999))
      .map((answer) => ({
        id: answer.id,
        playerId: answer.playerId,
        playerName: answer.player?.displayName ?? 'Player',
        avatar: answer.player?.avatar ?? 'emoji:🎉',
        submittedAnswer: answer.submittedAnswer,
        isCorrect: answer.isCorrect,
        status: answer.status,
        awardedPoints: answer.awardedPoints,
        submittedAt: answer.submittedAt,
        suggestedCorrect:
          question.type === 'text' &&
          normalizeAnswer(answer.submittedAnswer) === normalizeAnswer(question.correctAnswer),
      }));
  }

  buildPublicStateFromGraph(session, viewerPlayerId = null) {
    const state = this.runtime.get(session.id) ?? this.createRuntimeState(session);
    this.refreshAutoAdvanceRemaining(state);
    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;
    const currentAnswers = question
      ? session.answers.filter((answer) => answer.questionId === question.id)
      : [];
    const viewerAnswer = viewerPlayerId
      ? currentAnswers.find((answer) => answer.playerId === Number(viewerPlayerId)) ?? null
      : null;
    const buzzPlayer = state.currentBuzzPlayerId
      ? session.players.find((player) => player.id === state.currentBuzzPlayerId) ?? null
      : null;

    return {
      id: session.id,
      joinCode: session.joinCode,
      status: session.status,
      phase: session.phase,
      mode: session.quiz.mode,
      title: session.quiz.title,
      description: session.quiz.description,
      accentColor: session.quiz.accentColor,
      currentQuestionIndex: session.currentQuestionIndex,
      totalQuestions: session.quiz.questions.length,
      playerCount: session.players.length,
      connectedPlayerCount: session.players.filter((player) => player.isConnected).length,
      currentQuestion: question
        ? sanitizeQuestion(
            {
              ...question.toJSON(),
              mediaVersion: state.currentQuestionMediaVersion,
            },
            session.phase,
          )
        : null,
      closesAt: state.closesAt,
      answerDurationSeconds: state.sessionAnswerDurationSeconds,
      autoAdvanceAt: state.autoAdvanceAt,
      autoAdvanceEnabled: state.autoAdvanceEnabled,
      autoAdvancePaused: state.autoAdvancePaused,
      autoAdvanceDurationSeconds: state.autoAdvanceDurationSeconds,
      autoAdvanceRemainingSeconds: state.autoAdvanceRemainingSeconds,
      answerCount: currentAnswers.length,
      leaderboard: this.createLeaderboard(session),
      lockedBuzzPlayer: buzzPlayer
        ? {
            playerId: buzzPlayer.id,
            displayName: buzzPlayer.displayName,
          }
        : null,
      deniedBuzzPlayerIds: Array.from(state.deniedBuzzPlayerIds),
      viewerAnswer: viewerAnswer
        ? {
            submittedAnswer: viewerAnswer.submittedAnswer,
            status: viewerAnswer.status,
            isCorrect: viewerAnswer.isCorrect,
            awardedPoints: viewerAnswer.awardedPoints,
          }
        : null,
      viewerScore:
        viewerPlayerId != null
          ? session.scores.find((score) => score.playerId === Number(viewerPlayerId))?.points ?? 0
          : null,
    };
  }

  buildAdminStateFromGraph(session) {
    const state = this.runtime.get(session.id) ?? this.createRuntimeState(session);
    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;

    return {
      ...this.buildPublicStateFromGraph(session),
      players: session.players.map((player) => ({
        id: player.id,
        displayName: player.displayName,
        avatar: player.avatar,
        playerCode: player.rejoinCode,
        preferredLanguage: player.preferredLanguage,
        isConnected: player.isConnected,
        lastSeenAt: player.lastSeenAt,
      })),
      answers: this.createQuestionReview(session, question),
      buzzAttemptText: state.buzzAttemptText,
      activeBuzzPlayerId: state.currentBuzzPlayerId,
    };
  }

  async emitState(sessionId) {
    if (!this.io) {
      return;
    }

    const session = await this.getSessionGraph(sessionId);
    const publicState = this.buildPublicStateFromGraph(session);
    const adminState = this.buildAdminStateFromGraph(session);

    this.io.to(this.getRoom(sessionId)).emit('session:state', publicState);
    this.io.to(this.getAdminRoom(sessionId)).emit('admin:state', adminState);
    this.io.to(this.getRoom(sessionId)).emit('leaderboard:update', publicState.leaderboard);
    this.io.to(this.getAdminRoom(sessionId)).emit('leaderboard:update', publicState.leaderboard);
  }

  async getOrCreateScore(sessionId, playerId) {
    const [score] = await Score.findOrCreate({
      where: { sessionId, playerId },
      defaults: { points: 0 },
    });
    return score;
  }

  async applyScoreDelta(sessionId, playerId, delta) {
    const score = await this.getOrCreateScore(sessionId, playerId);
    score.points += delta;
    await score.save();
    return score;
  }

  async createSession(quizId) {
    const quiz = await Quiz.findByPk(quizId);
    if (!quiz) {
      throw new Error('Quiz not found');
    }

    const joinCode = await this.ensureJoinCode();
    const session = await GameSession.create({
      quizId,
      joinCode,
      status: 'lobby',
      phase: 'waiting',
      currentQuestionIndex: -1,
    });

    await this.ensureState(session.id);
    return this.getSessionGraph(session.id);
  }

  async listPublicSessions() {
    const sessions = await GameSession.findAll({
      where: {
        status: {
          [Op.ne]: 'finished',
        },
      },
      include: [
        {
          model: Quiz,
          as: 'quiz',
          include: [{ model: Question, as: 'questions' }],
        },
        {
          model: Player,
          as: 'players',
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    return sessions.map((session) => {
      session.quiz.questions.sort((left, right) => left.order - right.order);
      return this.createPublicSessionSummary(session);
    });
  }

  async joinPlayer({ joinCode, displayName, avatar, preferredLanguage }) {
    const session = await GameSession.findOne({
      where: {
        joinCode: joinCode.toUpperCase(),
        status: { [Op.ne]: 'finished' },
      },
      include: [{ model: Quiz, as: 'quiz' }],
    });

    if (!session) {
      throw new Error('Active session not found');
    }

    const player = await Player.create({
      sessionId: session.id,
      displayName: displayName.trim(),
      avatar: avatar || 'emoji:🎉',
      preferredLanguage: preferredLanguage || 'en',
      rejoinCode: await this.ensureRejoinCode(session.id),
      isConnected: true,
      lastSeenAt: new Date(),
    });

    await Score.findOrCreate({
      where: { sessionId: session.id, playerId: player.id },
      defaults: { points: 0 },
    });

    await this.emitState(session.id);
    return { session, player };
  }

  async rejoinPlayer({ joinCode, playerCode }) {
    const session = await GameSession.findOne({
      where: { joinCode: joinCode.toUpperCase() },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    const player = await Player.findOne({
      where: {
        sessionId: session.id,
        rejoinCode: playerCode.trim(),
      },
    });

    if (!player) {
      throw new Error('Player code is invalid');
    }

    player.isConnected = true;
    player.lastSeenAt = new Date();
    await player.save();

    await Score.findOrCreate({
      where: { sessionId: session.id, playerId: player.id },
      defaults: { points: 0 },
    });

    await this.emitState(session.id);
    return { session, player };
  }

  async attachPlayerSocket(sessionId, playerId, socketId) {
    const player = await Player.findOne({ where: { id: playerId, sessionId } });
    if (!player) {
      throw new Error('Player not found');
    }

    player.socketId = socketId;
    player.isConnected = true;
    player.lastSeenAt = new Date();
    await player.save();
    await this.emitState(sessionId);
    return player;
  }

  async disconnectPlayer(socketId) {
    const player = await Player.findOne({ where: { socketId } });
    if (!player) {
      return;
    }

    player.isConnected = false;
    player.lastSeenAt = new Date();
    player.socketId = null;
    await player.save();
    await this.emitState(player.sessionId);
  }

  async startQuestion(sessionId, questionIndex) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);
    const question = session.quiz.questions[questionIndex] ?? null;

    if (!question) {
      throw new Error('Question not found');
    }

    session.status = 'live';
    session.phase = 'open';
    session.currentQuestionIndex = questionIndex;
    session.startedAt = session.startedAt ?? new Date();
    session.endedAt = null;
    await session.save();

    this.clearTimer(state);
    this.clearAutoAdvanceTimer(state);
    state.phase = 'open';
    this.resetAutoAdvanceSchedule(state);
    state.currentQuestionMediaVersion = Date.now();
    state.currentBuzzPlayerId = null;
    state.buzzAttemptText = '';
    state.deniedBuzzPlayerIds = new Set();
    this.startQuestionTimer(sessionId, question, state);

    await this.emitState(sessionId);
    return this.getSessionGraph(sessionId);
  }

  async advanceQuestion(sessionId) {
    const session = await this.getSessionGraph(sessionId);

    if (session.phase === 'open') {
      throw new Error('Close the current question first');
    }

    const nextIndex = session.currentQuestionIndex + 1;
    if (nextIndex >= session.quiz.questions.length) {
      return this.finishSession(sessionId);
    }

    return this.startQuestion(sessionId, nextIndex);
  }

  async closeActiveQuestion(sessionId) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);

    if (session.phase !== 'open') {
      return session;
    }

    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;
    if (!question) {
      throw new Error('No question is currently active');
    }

    this.resetQuestionTimer(state);
    state.currentBuzzPlayerId = null;
    state.buzzAttemptText = '';

    if (session.quiz.mode === 'classic' && question.type === 'multiple_choice') {
      const answers = await Answer.findAll({
        where: {
          sessionId,
          questionId: question.id,
        },
      });

      for (const answer of answers) {
        if (answer.status === 'judged') {
          continue;
        }

        const isCorrect = normalizeAnswer(answer.submittedAnswer) === normalizeAnswer(question.correctAnswer);
        answer.isCorrect = isCorrect;
        answer.awardedPoints = isCorrect ? question.points : 0;
        answer.status = 'judged';
        await answer.save();

        if (isCorrect) {
          await this.applyScoreDelta(sessionId, answer.playerId, question.points);
        }
      }
    }

    session.phase = 'review';
    await session.save();
    state.phase = 'review';
    await this.syncAutoAdvance(sessionId, session, { resetCountdown: true });
    await this.emitState(sessionId);

    return this.getSessionGraph(sessionId);
  }

  async finishSession(sessionId) {
    const session = await GameSession.findByPk(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const state = await this.ensureState(sessionId);
    this.clearTimer(state);
    this.clearAutoAdvanceTimer(state);
    state.phase = 'finished';
    state.closesAt = null;
    state.autoAdvanceAt = null;
    state.autoAdvanceAction = null;
    state.autoAdvanceRemainingSeconds = state.autoAdvanceDurationSeconds;
    state.currentQuestionMediaVersion = null;
    state.currentBuzzPlayerId = null;
    state.buzzAttemptText = '';
    state.deniedBuzzPlayerIds = new Set();

    session.status = 'finished';
    session.phase = 'finished';
    session.endedAt = new Date();
    await session.save();

    await this.emitState(sessionId);
    return this.getSessionGraph(sessionId);
  }

  async replayQuestion(sessionId) {
    const session = await this.getSessionGraph(sessionId);
    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;

    if (!question) {
      throw new Error('There is no previous question to replay');
    }

    const answers = await Answer.findAll({
      where: {
        sessionId,
        questionId: question.id,
      },
    });

    for (const answer of answers) {
      if (answer.awardedPoints !== 0) {
        await this.applyScoreDelta(sessionId, answer.playerId, -answer.awardedPoints);
      }
    }

    await Answer.destroy({
      where: {
        sessionId,
        questionId: question.id,
      },
    });

    return this.startQuestion(sessionId, session.currentQuestionIndex);
  }

  async submitClassicAnswer({ sessionId, playerId, value }) {
    const session = await this.getSessionGraph(sessionId);
    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;

    if (!question || session.phase !== 'open' || session.quiz.mode !== 'classic') {
      throw new Error('No classic question is open');
    }

    const [answer] = await Answer.findOrCreate({
      where: {
        sessionId,
        playerId,
        questionId: question.id,
      },
      defaults: {
        submittedAnswer: value,
        submittedAt: new Date(),
      },
    });

    answer.submittedAnswer = value;
    answer.submittedAt = new Date();
    answer.status = 'submitted';
    answer.isCorrect = null;
    answer.awardedPoints = 0;
    await answer.save();

    await this.emitState(sessionId);
    return answer;
  }

  async buzzIn({ sessionId, playerId }) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);
    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;

    if (!question || session.phase !== 'open' || session.quiz.mode !== 'buzz') {
      throw new Error('No buzz question is open');
    }

    if (state.currentBuzzPlayerId) {
      throw new Error('Another player already has the buzz');
    }

    if (state.deniedBuzzPlayerIds.has(Number(playerId))) {
      throw new Error('This player cannot buzz again on the current question');
    }

    const currentAnswers = await Answer.count({
      where: { sessionId, questionId: question.id },
    });
    const [answer] = await Answer.findOrCreate({
      where: {
        sessionId,
        playerId,
        questionId: question.id,
      },
      defaults: {
        buzzOrder: currentAnswers + 1,
        submittedAt: new Date(),
      },
    });

    answer.buzzOrder = answer.buzzOrder ?? currentAnswers + 1;
    answer.submittedAt = new Date();
    await answer.save();

    state.currentBuzzPlayerId = Number(playerId);
    state.buzzAttemptText = '';
    await this.emitState(sessionId);

    return answer;
  }

  async submitBuzzAttempt({ sessionId, playerId, value }) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);
    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;

    if (!question || session.phase !== 'open' || session.quiz.mode !== 'buzz') {
      throw new Error('No buzz question is open');
    }

    if (state.currentBuzzPlayerId !== Number(playerId)) {
      throw new Error('Only the current buzzer can submit an answer');
    }

    const [answer] = await Answer.findOrCreate({
      where: {
        sessionId,
        playerId,
        questionId: question.id,
      },
      defaults: {
        submittedAt: new Date(),
      },
    });

    answer.submittedAnswer = value;
    answer.submittedAt = new Date();
    answer.status = 'submitted';
    answer.isCorrect = null;
    answer.awardedPoints = 0;
    await answer.save();

    state.buzzAttemptText = value;
    await this.emitState(sessionId);
    return answer;
  }

  async judgeAnswer({ answerId, isCorrect }) {
    const answer = await Answer.findByPk(answerId, {
      include: [{ model: Question, as: 'question' }],
    });

    if (!answer) {
      throw new Error('Answer not found');
    }

    const targetPoints = isCorrect ? answer.question.points : 0;
    const delta = targetPoints - answer.awardedPoints;

    answer.isCorrect = isCorrect;
    answer.status = 'judged';
    answer.awardedPoints = targetPoints;
    await answer.save();

    if (delta !== 0) {
      await this.applyScoreDelta(answer.sessionId, answer.playerId, delta);
    }

    await this.emitState(answer.sessionId);
    return answer;
  }

  async judgeBuzz({ sessionId, isCorrect }) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);
    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;

    if (!question || !state.currentBuzzPlayerId) {
      throw new Error('There is no active buzz attempt to judge');
    }

    const [answer] = await Answer.findOrCreate({
      where: {
        sessionId,
        playerId: state.currentBuzzPlayerId,
        questionId: question.id,
      },
      defaults: {
        submittedAt: new Date(),
      },
    });

    if (isCorrect) {
      answer.isCorrect = true;
      answer.status = 'judged';
      answer.awardedPoints = question.points;
      await answer.save();
      await this.applyScoreDelta(sessionId, state.currentBuzzPlayerId, question.points);

      this.resetQuestionTimer(state);
      this.resetAutoAdvanceSchedule(state);
      state.currentQuestionMediaVersion = Date.now();
      state.currentBuzzPlayerId = null;
      state.buzzAttemptText = '';
      session.phase = 'review';
      await session.save();
      state.phase = 'review';
      await this.syncAutoAdvance(sessionId, session, { resetCountdown: true });
    } else {
      const penalty = Math.abs(question.penaltyPoints || 0);
      answer.isCorrect = false;
      answer.status = 'judged';
      answer.awardedPoints = penalty > 0 ? -penalty : 0;
      await answer.save();

      if (penalty > 0) {
        await this.applyScoreDelta(sessionId, state.currentBuzzPlayerId, -penalty);
      }

      state.deniedBuzzPlayerIds.add(state.currentBuzzPlayerId);
      state.currentBuzzPlayerId = null;
      state.buzzAttemptText = '';
    }

    await this.emitState(sessionId);
    return answer;
  }

  async kickPlayer(sessionId, playerId) {
    const state = await this.ensureState(sessionId);
    const player = await Player.findOne({
      where: {
        id: playerId,
        sessionId,
      },
    });

    if (!player) {
      throw new Error('Player not found');
    }

    if (player.socketId && this.io) {
      this.io.to(player.socketId).emit('player:kicked', { sessionId, playerId });
    }

    if (state.currentBuzzPlayerId === Number(playerId)) {
      state.currentBuzzPlayerId = null;
      state.buzzAttemptText = '';
    }

    await Answer.destroy({
      where: {
        sessionId,
        playerId,
      },
    });
    await Score.destroy({
      where: {
        sessionId,
        playerId,
      },
    });
    await player.destroy();
    await this.emitState(sessionId);
  }

  async updateAutoAdvance(sessionId, { enabled, paused, durationSeconds, answerDurationSeconds }) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);
    const enabledChanged = typeof enabled === 'boolean';
    const parsedDuration = Number(durationSeconds);
    const hasDurationChange =
      Number.isFinite(parsedDuration) &&
      parsedDuration > 0 &&
      parsedDuration !== state.autoAdvanceDurationSeconds;

    const parsedAnswerDuration = Number(answerDurationSeconds);
    if (Number.isFinite(parsedAnswerDuration) && parsedAnswerDuration > 0) {
      state.sessionAnswerDurationSeconds = Math.max(1, Math.round(parsedAnswerDuration));
    }

    if (hasDurationChange) {
      state.autoAdvanceDurationSeconds = Math.max(1, Math.round(parsedDuration));
      this.resetAutoAdvanceSchedule(state);
    }

    if (enabledChanged) {
      state.autoAdvanceEnabled = enabled;
      state.autoAdvancePaused = false;
      this.resetAutoAdvanceSchedule(state);
    }

    if (typeof paused === 'boolean' && !enabledChanged && state.autoAdvanceEnabled) {
      this.refreshAutoAdvanceRemaining(state);
      state.autoAdvancePaused = paused;

      if (paused && state.autoAdvanceAt) {
        this.clearAutoAdvanceTimer(state);
        state.autoAdvanceAt = null;
      }

      if (!paused && (!state.autoAdvanceRemainingSeconds || state.autoAdvanceRemainingSeconds < 1)) {
        state.autoAdvanceRemainingSeconds = state.autoAdvanceDurationSeconds;
      }
    }

    await this.syncAutoAdvance(sessionId, session, {
      resetCountdown: enabled === true || hasDurationChange,
    });
    await this.emitState(sessionId);
    return this.getAdminSession(sessionId);
  }

  async deleteSession(sessionId) {
    const session = await GameSession.findByPk(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const state = await this.ensureState(Number(sessionId));
    this.clearTimer(state);
    this.clearAutoAdvanceTimer(state);
    this.runtime.delete(Number(sessionId));

    await session.destroy();
  }

  async getSessionByJoinCode(joinCode, viewerPlayerId = null) {
    const session = await GameSession.findOne({
      where: { joinCode: joinCode.toUpperCase() },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    const graph = await this.getSessionGraph(session.id);
    await this.ensureState(graph.id);
    return this.buildPublicStateFromGraph(graph, viewerPlayerId);
  }

  async getAdminSession(sessionId) {
    const graph = await this.getSessionGraph(sessionId);
    await this.ensureState(graph.id);
    return this.buildAdminStateFromGraph(graph);
  }
}

module.exports = {
  SessionRuntimeService,
};
