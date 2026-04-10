const { Op } = require('sequelize');
const { Answer, GameSession, Player, Question, Quiz, Score } = require('../models');
const { createJoinCode, createRejoinCode, normalizeAnswer, sanitizeQuestion } = require('./utils');
const { sortQuestionsByRoundOrder } = require('./quizStorageService');

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
      questionRemainingSeconds: 0,
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
      // Board mode state
      boardSelectingPlayerId: null,
      lastSuccessfulPlayerId: null,
      boardAnsweredQuestionIds: new Set(),
      // Cat in the Bag
      catInBagPhase: null,
      catInBagTargetPlayerId: null,
      // Stakes
      stakesPhase: null,
      stakesWagers: {},
      stakesSelectedPlayerId: null,
    };
  }

  getState(sessionId) {
    return this.runtime.get(Number(sessionId)) ?? null;
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
    const id = Number(sessionId);
    if (this.runtime.has(id)) {
      return this.runtime.get(id);
    }

    const session = await GameSession.findByPk(id);
    const state = this.createRuntimeState(session);

    // Restore board answered questions from DB answers
    if (session && session.status === 'live') {
      const answers = await Answer.findAll({
        where: { sessionId: id },
        attributes: ['questionId'],
      });
      answers.forEach((a) => state.boardAnsweredQuestionIds.add(a.questionId));
      // If current question is still open, don't count it as answered yet
      if (session.phase === 'open' && session.currentQuestionIndex >= 0) {
        const quiz = await Quiz.findByPk(session.quizId, {
          include: [{ model: Question, as: 'questions' }],
        });
        if (quiz) {
          sortQuestionsByRoundOrder(quiz.questions, quiz.boardLayout);
          const currentQ = quiz.questions[session.currentQuestionIndex];
          if (currentQ) state.boardAnsweredQuestionIds.delete(currentQ.id);
        }
      }
    }

    this.runtime.set(id, state);
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

  clearRuntimeState(sessionId) {
    const numericSessionId = Number(sessionId);
    const state = this.getState(numericSessionId);
    if (!state) return;
    this.clearTimer(state);
    this.clearAutoAdvanceTimer(state);
    this.runtime.delete(numericSessionId);
  }

  resetQuestionTimer(state) {
    this.clearTimer(state);
    state.closesAt = null;
    state.questionRemainingSeconds = 0;
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
    if (!targetTime) return 0;
    return Math.max(0, Math.ceil((new Date(targetTime).getTime() - Date.now()) / 1000));
  }

  getQuestionTimerDurationSeconds(state, question) {
    const sessionAnswer = Number(state?.sessionAnswerDurationSeconds ?? 0);
    const questionAnswer = Number(question?.timeLimitSeconds ?? 0);
    return Math.max(0, sessionAnswer > 0 ? sessionAnswer : questionAnswer);
  }

  refreshQuestionRemaining(state) {
    if (!state) return 0;
    if (state.closesAt) {
      state.questionRemainingSeconds = this.getSecondsUntil(state.closesAt);
    }
    return state.questionRemainingSeconds;
  }

  refreshAutoAdvanceRemaining(state) {
    if (!state) return 0;
    if (state.autoAdvanceAt && !state.autoAdvancePaused) {
      state.autoAdvanceRemainingSeconds = this.getSecondsUntil(state.autoAdvanceAt);
    }
    return state.autoAdvanceRemainingSeconds;
  }

  getNextAutoAction(session, state) {
    if (!session || session.status !== 'live' || session.currentQuestionIndex < 0) return null;

    // Buzz mode: go back to board or finish
    if (session.quiz?.mode === 'buzz' && session.phase === 'review') {
      const totalQ = session.quiz.questions.length;
      const answeredCount = state ? state.boardAnsweredQuestionIds.size : 0;
      return answeredCount >= totalQ ? 'finish' : 'board';
    }

    if (session.phase !== 'review') return null;
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
      const currentState = this.getState(sessionId);
      if (!currentState?.autoAdvanceEnabled || currentState?.autoAdvancePaused) return;
      let nextStep;
      if (action === 'finish') {
        nextStep = this.finishSession(sessionId);
      } else if (action === 'board') {
        nextStep = this.returnToBoard(sessionId);
      } else {
        nextStep = this.advanceQuestion(sessionId);
      }
      nextStep.catch((error) => {
        console.error('Failed to auto-advance session', error);
      });
    }, safeRemainingSeconds * 1000);
  }

  scheduleQuestionTimer(sessionId, state, remainingSeconds) {
    this.clearTimer(state);

    const safeRemainingSeconds = Math.max(1, Number(remainingSeconds || 0));
    state.questionRemainingSeconds = safeRemainingSeconds;
    state.closesAt = new Date(Date.now() + safeRemainingSeconds * 1000).toISOString();
    state.timer = setTimeout(() => {
      if (!this.getState(sessionId)) return;
      this.closeActiveQuestion(sessionId).catch((error) => {
        console.error('Failed to auto-close question', error);
      });
    }, safeRemainingSeconds * 1000);
  }

  async syncQuestionTimer(sessionId, session = null, { resetCountdown = false } = {}) {
    const state = await this.ensureState(sessionId);
    const graph = session ?? (await this.getSessionGraph(sessionId));
    const question = graph.quiz.questions[graph.currentQuestionIndex] ?? null;

    this.refreshQuestionRemaining(state);

    if (!question || graph.status !== 'live' || graph.phase !== 'open' || graph.currentQuestionIndex < 0) {
      this.resetQuestionTimer(state);
      return;
    }

    const durationSeconds = this.getQuestionTimerDurationSeconds(state, question);
    if (durationSeconds <= 0) {
      this.resetQuestionTimer(state);
      return;
    }

    if (resetCountdown || !state.questionRemainingSeconds || state.questionRemainingSeconds < 1) {
      state.questionRemainingSeconds = durationSeconds;
    }

    if (!state.autoAdvanceEnabled) {
      this.clearTimer(state);
      state.closesAt = null;
      state.questionRemainingSeconds = durationSeconds;
      return;
    }

    if (state.autoAdvancePaused) {
      this.clearTimer(state);
      state.closesAt = null;
      return;
    }

    this.scheduleQuestionTimer(sessionId, state, state.questionRemainingSeconds);
  }

  async syncAutoAdvance(sessionId, session = null, { resetCountdown = false } = {}) {
    const state = await this.ensureState(sessionId);
    const graph = session ?? (await this.getSessionGraph(sessionId));
    const nextAction = this.getNextAutoAction(graph, state);

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

    if (resetCountdown || actionChanged || !state.autoAdvanceRemainingSeconds || state.autoAdvanceRemainingSeconds < 1) {
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

    if (!session) throw new Error('Session not found');

    sortQuestionsByRoundOrder(session.quiz.questions, session.quiz.boardLayout);
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
    if (!question) return [];

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

  getOrderedRoundNames(session) {
    const orderedRoundNames = [];
    const boardLayout = Array.isArray(session.quiz.boardLayout) ? session.quiz.boardLayout : [];

    for (const round of boardLayout) {
      if (round?.name && !orderedRoundNames.includes(round.name)) {
        orderedRoundNames.push(round.name);
      }
    }

    for (const question of session.quiz.questions) {
      if (question?.roundName && !orderedRoundNames.includes(question.roundName)) {
        orderedRoundNames.push(question.roundName);
      }
    }

    return orderedRoundNames;
  }

  getPendingRoundName(session, state) {
    if (session.quiz.mode !== 'buzz') return null;

    const unansweredQuestions = session.quiz.questions.filter(
      (question) => !state.boardAnsweredQuestionIds.has(question.id),
    );

    const orderedRoundNames = this.getOrderedRoundNames(session);
    for (const roundName of orderedRoundNames) {
      if (unansweredQuestions.some((question) => question.roundName === roundName)) {
        return roundName;
      }
    }

    const unansweredQuestion = unansweredQuestions[0] ?? null;
    if (unansweredQuestion?.roundName) return unansweredQuestion.roundName;

    if (orderedRoundNames[0]) return orderedRoundNames[0];

    const firstRoundQuestion = session.quiz.questions.find((question) => question.roundName);
    return firstRoundQuestion?.roundName ?? null;
  }

  getBoardRoundName(session, state) {
    if (session.quiz.mode !== 'buzz') return null;

    if (session.phase === 'open' || session.phase === 'review') {
      const currentQuestion = session.quiz.questions[session.currentQuestionIndex] ?? null;
      if (currentQuestion?.roundName) return currentQuestion.roundName;
    }

    return this.getPendingRoundName(session, state);
  }

  buildBoardColumns(questions, roundName = null, boardLayout = []) {
    const scopedQuestions = roundName
      ? questions.filter((question) => question.roundName === roundName)
      : questions;
    const columnMap = new Map();

    for (const q of scopedQuestions) {
      const col = q.columnName || 'General';
      if (!columnMap.has(col)) columnMap.set(col, []);
      columnMap.get(col).push({
        id: q.id,
        points: q.points,
        specialType: q.specialType || 'normal',
        columnName: col,
      });
    }

    const orderedColumnNames = [];
    const activeRound = Array.isArray(boardLayout)
      ? boardLayout.find((round) => round?.name === roundName)
      : null;

    for (const column of activeRound?.columns ?? []) {
      if (column?.name && columnMap.has(column.name)) {
        orderedColumnNames.push(column.name);
      }
    }

    for (const name of columnMap.keys()) {
      if (!orderedColumnNames.includes(name)) {
        orderedColumnNames.push(name);
      }
    }

    return orderedColumnNames.map((name) => ({
      name,
      tiles: (columnMap.get(name) ?? []).sort((a, b) => a.points - b.points),
    }));
  }

  getUpcomingRoundName(session, state) {
    return this.getPendingRoundName(session, state);
  }

  buildPublicStateFromGraph(session, viewerPlayerId = null) {
    const state = this.getState(session.id) ?? this.createRuntimeState(session);
    this.refreshQuestionRemaining(state);
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
    const catInBagTargetPlayer = state.catInBagTargetPlayerId
      ? session.players.find((p) => p.id === state.catInBagTargetPlayerId) ?? null
      : null;
    const stakesSelectedPlayer = state.stakesSelectedPlayerId
      ? session.players.find((p) => p.id === state.stakesSelectedPlayerId) ?? null
      : null;

    const boardRoundName = this.getBoardRoundName(session, state);

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
      serverNow: new Date().toISOString(),
      closesAt: state.closesAt,
      questionRemainingSeconds: state.questionRemainingSeconds,
      answerDurationSeconds: state.sessionAnswerDurationSeconds,
      autoAdvanceAt: state.autoAdvanceAt,
      autoAdvanceEnabled: state.autoAdvanceEnabled,
      autoAdvancePaused: state.autoAdvancePaused,
      autoAdvanceDurationSeconds: state.autoAdvanceDurationSeconds,
      autoAdvanceRemainingSeconds: state.autoAdvanceRemainingSeconds,
      answerCount: currentAnswers.length,
      leaderboard: this.createLeaderboard(session),
      lockedBuzzPlayer: buzzPlayer
        ? { playerId: buzzPlayer.id, displayName: buzzPlayer.displayName }
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
      // Board mode fields
      boardSelectingPlayerId: state.boardSelectingPlayerId,
      boardAnsweredQuestionIds: Array.from(state.boardAnsweredQuestionIds),
      boardColumns: session.quiz.mode === 'buzz'
        ? this.buildBoardColumns(session.quiz.questions, boardRoundName, session.quiz.boardLayout)
        : [],
      upcomingRoundName: this.getUpcomingRoundName(session, state),
      catInBagPhase: state.catInBagPhase,
      catInBagTargetPlayerId: state.catInBagTargetPlayerId,
      catInBagTargetName: catInBagTargetPlayer?.displayName ?? null,
      stakesPhase: state.stakesPhase,
      stakesSelectedPlayerId: state.stakesSelectedPlayerId,
      stakesSelectedName: stakesSelectedPlayer?.displayName ?? null,
    };
  }

  buildAdminStateFromGraph(session) {
    const state = this.getState(session.id) ?? this.createRuntimeState(session);
    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;
    const scoreMap = new Map(session.scores.map((s) => [s.playerId, s.points]));

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
        score: scoreMap.get(player.id) ?? 0,
      })),
      answers: this.createQuestionReview(session, question),
      buzzAttemptText: state.buzzAttemptText,
      activeBuzzPlayerId: state.currentBuzzPlayerId,
      stakesWagers: state.stakesWagers,
      correctAnswer: question ? question.correctAnswer : null,
      correctAnswerMediaType: question ? (question.correctAnswerMediaType || 'none') : 'none',
      correctAnswerMediaUrl: question ? (question.correctAnswerMediaUrl || '') : '',
    };
  }

  async emitState(sessionId) {
    if (!this.io) return;

    const session = await this.getSessionGraph(sessionId);
    const publicState = this.buildPublicStateFromGraph(session);
    const adminState = this.buildAdminStateFromGraph(session);

    this.io.to(this.getRoom(sessionId)).emit('session:state', publicState);
    this.io.to(this.getAdminRoom(sessionId)).emit('admin:state', adminState);
    this.io.to(this.getRoom(sessionId)).emit('leaderboard:update', publicState.leaderboard);
    this.io.to(this.getAdminRoom(sessionId)).emit('leaderboard:update', publicState.leaderboard);
  }

  emitAdminBuzzText(sessionId, playerId, text) {
    if (!this.io) return;
    this.io.to(this.getAdminRoom(sessionId)).emit('admin:buzz-text', { playerId, text });
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
    if (!quiz) throw new Error('Quiz not found');

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
      where: { status: { [Op.ne]: 'finished' } },
      include: [
        { model: Quiz, as: 'quiz', include: [{ model: Question, as: 'questions' }] },
        { model: Player, as: 'players' },
      ],
      order: [['createdAt', 'DESC']],
    });

    return sessions.map((session) => {
      sortQuestionsByRoundOrder(session.quiz.questions, session.quiz.boardLayout);
      return this.createPublicSessionSummary(session);
    });
  }

  async joinPlayer({ joinCode, displayName, avatar, preferredLanguage }) {
    const session = await GameSession.findOne({
      where: { joinCode: joinCode.toUpperCase(), status: { [Op.ne]: 'finished' } },
      include: [{ model: Quiz, as: 'quiz' }],
    });

    if (!session) throw new Error('Active session not found');

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
    const session = await GameSession.findOne({ where: { joinCode: joinCode.toUpperCase() } });
    if (!session) throw new Error('Session not found');

    const player = await Player.findOne({
      where: { sessionId: session.id, rejoinCode: playerCode.trim() },
    });

    if (!player) throw new Error('Player code is invalid');

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
    if (!player) throw new Error('Player not found');

    player.socketId = socketId;
    player.isConnected = true;
    player.lastSeenAt = new Date();
    await player.save();
    await this.emitState(sessionId);
    return player;
  }

  async disconnectPlayer(socketId) {
    const player = await Player.findOne({ where: { socketId } });
    if (!player) return;

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

    if (!question) throw new Error('Question not found');

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

    // Board mode: set up special question phases
    const specialType = question.specialType || 'normal';
    if (session.quiz.mode === 'buzz' && specialType === 'cat_in_bag') {
      state.catInBagPhase = 'selecting';
      state.catInBagTargetPlayerId = null;
    } else {
      state.catInBagPhase = null;
      state.catInBagTargetPlayerId = null;
    }

    if (session.quiz.mode === 'buzz' && specialType === 'stakes') {
      state.stakesPhase = 'collecting';
      state.stakesWagers = {};
      state.stakesSelectedPlayerId = null;
    } else {
      state.stakesPhase = null;
      state.stakesWagers = {};
      state.stakesSelectedPlayerId = null;
    }

    await this.syncQuestionTimer(sessionId, session, { resetCountdown: true });
    await this.emitState(sessionId);
    return this.getSessionGraph(sessionId);
  }

  async advanceQuestion(sessionId) {
    const session = await this.getSessionGraph(sessionId);

    if (session.phase === 'open') throw new Error('Close the current question first');

    // Buzz mode: go back to board or finish
    if (session.quiz.mode === 'buzz') {
      const state = await this.ensureState(sessionId);
      const totalQ = session.quiz.questions.length;
      if (state.boardAnsweredQuestionIds.size >= totalQ) {
        return this.finishSession(sessionId);
      }
      return this.returnToBoard(sessionId, session);
    }

    // Classic mode: sequential advance
    const nextIndex = session.currentQuestionIndex + 1;
    if (nextIndex >= session.quiz.questions.length) {
      return this.finishSession(sessionId);
    }

    return this.startQuestion(sessionId, nextIndex);
  }

  async returnToBoard(sessionId, session = null) {
    const graph = session ?? (await this.getSessionGraph(sessionId));
    const state = await this.ensureState(sessionId);

    this.clearTimer(state);
    this.clearAutoAdvanceTimer(state);
    this.resetAutoAdvanceSchedule(state);

    state.phase = 'waiting';
    state.currentBuzzPlayerId = null;
    state.buzzAttemptText = '';
    state.catInBagPhase = null;
    state.catInBagTargetPlayerId = null;
    state.stakesPhase = null;
    state.stakesWagers = {};
    state.stakesSelectedPlayerId = null;

    graph.status = 'live';
    graph.phase = 'waiting';
    graph.startedAt = graph.startedAt ?? new Date();
    await graph.save();

    await this.emitState(sessionId);
    return this.getSessionGraph(sessionId);
  }

  async closeActiveQuestion(sessionId) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);

    if (session.phase !== 'open') return session;

    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;
    if (!question) throw new Error('No question is currently active');

    this.resetQuestionTimer(state);
    state.currentBuzzPlayerId = null;
    state.buzzAttemptText = '';

    // Mark the question as answered on the board
    if (session.quiz.mode === 'buzz') {
      state.boardAnsweredQuestionIds.add(question.id);
    }

    if (session.quiz.mode === 'classic' && question.type === 'multiple_choice') {
      const answers = await Answer.findAll({ where: { sessionId, questionId: question.id } });

      for (const answer of answers) {
        if (answer.status === 'judged') continue;
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
    if (!session) throw new Error('Session not found');

    const state = await this.ensureState(sessionId);
    this.clearTimer(state);
    this.clearAutoAdvanceTimer(state);
    state.phase = 'finished';
    state.closesAt = null;
    state.questionRemainingSeconds = 0;
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
    const state = await this.ensureState(sessionId);
    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;

    if (!question) throw new Error('There is no previous question to replay');

    const answers = await Answer.findAll({ where: { sessionId, questionId: question.id } });

    for (const answer of answers) {
      if (answer.awardedPoints !== 0) {
        await this.applyScoreDelta(sessionId, answer.playerId, -answer.awardedPoints);
      }
    }

    await Answer.destroy({ where: { sessionId, questionId: question.id } });

    // Remove from answered set
    state.boardAnsweredQuestionIds.delete(question.id);

    return this.startQuestion(sessionId, session.currentQuestionIndex);
  }

  async submitClassicAnswer({ sessionId, playerId, value }) {
    const session = await this.getSessionGraph(sessionId);
    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;

    if (!question || session.phase !== 'open' || session.quiz.mode !== 'classic') {
      throw new Error('No classic question is open');
    }

    const [answer] = await Answer.findOrCreate({
      where: { sessionId, playerId, questionId: question.id },
      defaults: { submittedAnswer: value, submittedAt: new Date() },
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

    // Stakes mode: only the selected player can buzz
    if (state.stakesPhase === 'answering' && state.stakesSelectedPlayerId !== Number(playerId)) {
      throw new Error('Only the selected player can answer this question');
    }

    // CiB: only the target player can buzz
    if (state.catInBagPhase === null && state.catInBagTargetPlayerId !== null) {
      if (state.catInBagTargetPlayerId !== Number(playerId)) {
        throw new Error('Only the assigned player can answer this question');
      }
    }

    if (state.catInBagPhase === 'selecting') {
      throw new Error('Waiting for Cat in the Bag assignment');
    }

    if (state.currentBuzzPlayerId) throw new Error('Another player already has the buzz');

    if (state.deniedBuzzPlayerIds.has(Number(playerId))) {
      throw new Error('This player cannot buzz again on the current question');
    }

    const currentAnswers = await Answer.count({ where: { sessionId, questionId: question.id } });
    const [answer] = await Answer.findOrCreate({
      where: { sessionId, playerId, questionId: question.id },
      defaults: { buzzOrder: currentAnswers + 1, submittedAt: new Date() },
    });

    answer.buzzOrder = answer.buzzOrder ?? currentAnswers + 1;
    answer.submittedAt = new Date();
    await answer.save();

    state.currentBuzzPlayerId = Number(playerId);
    state.buzzAttemptText = '';
    await this.emitState(sessionId);

    return answer;
  }

  async updateBuzzAnswerLive({ sessionId, playerId, text }) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);

    if (session.phase !== 'open' || session.quiz.mode !== 'buzz') return;
    if (state.currentBuzzPlayerId !== Number(playerId)) return;

    state.buzzAttemptText = text;
    // Emit lightweight update to admin room only
    this.emitAdminBuzzText(sessionId, playerId, text);
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
      where: { sessionId, playerId, questionId: question.id },
      defaults: { submittedAt: new Date() },
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

    if (!answer) throw new Error('Answer not found');

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
      where: { sessionId, playerId: state.currentBuzzPlayerId, questionId: question.id },
      defaults: { submittedAt: new Date() },
    });

    if (isCorrect) {
      answer.isCorrect = true;
      answer.status = 'judged';
      answer.awardedPoints = question.points;
      await answer.save();
      await this.applyScoreDelta(sessionId, state.currentBuzzPlayerId, question.points);

      // Update board selector to the winner
      state.lastSuccessfulPlayerId = state.currentBuzzPlayerId;
      state.boardSelectingPlayerId = state.currentBuzzPlayerId;
      state.boardAnsweredQuestionIds.add(question.id);

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

  // Board mode: player selects a question tile
  async selectBoardQuestion({ sessionId, playerId, questionId }) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);

    if (session.status !== 'live' || session.phase !== 'waiting') {
      throw new Error('Not in board selection phase');
    }

    if (session.quiz.mode !== 'buzz') {
      throw new Error('Board selection is only available in buzz mode');
    }

    if (state.boardSelectingPlayerId !== Number(playerId)) {
      throw new Error('It is not your turn to select a question');
    }

    if (state.boardAnsweredQuestionIds.has(Number(questionId))) {
      throw new Error('This question has already been answered');
    }

    const questionIndex = session.quiz.questions.findIndex((q) => q.id === Number(questionId));
    if (questionIndex === -1) throw new Error('Question not found');

    return this.startQuestion(sessionId, questionIndex);
  }

  async adminSelectBoardQuestion({ sessionId, questionId }) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);

    if (session.status !== 'live' || session.phase !== 'waiting') {
      throw new Error('Not in board selection phase');
    }

    if (session.quiz.mode !== 'buzz') {
      throw new Error('Board selection is only available in buzz mode');
    }

    if (state.boardAnsweredQuestionIds.has(Number(questionId))) {
      throw new Error('This question has already been answered');
    }

    const questionIndex = session.quiz.questions.findIndex((q) => q.id === Number(questionId));
    if (questionIndex === -1) throw new Error('Question not found');

    return this.startQuestion(sessionId, questionIndex);
  }

  // Admin assigns who selects the next board question
  async assignBoardSelector({ sessionId, playerId }) {
    const state = await this.ensureState(sessionId);
    const session = await this.getSessionGraph(sessionId);

    const player = session.players.find((p) => p.id === Number(playerId));
    if (!player) throw new Error('Player not found');

    state.boardSelectingPlayerId = Number(playerId);
    await this.emitState(sessionId);
  }

  // Manual score adjustment by admin
  async adjustPlayerScore({ sessionId, playerId, delta }) {
    const parsedDelta = Number(delta);
    if (!Number.isFinite(parsedDelta) || Math.abs(parsedDelta) > 100000) {
      throw new Error('Invalid score adjustment value');
    }

    const player = await Player.findOne({ where: { id: playerId, sessionId } });
    if (!player) throw new Error('Player not found');

    await this.applyScoreDelta(sessionId, playerId, parsedDelta);
    await this.emitState(sessionId);
    return this.getOrCreateScore(sessionId, playerId);
  }

  // Cat in the Bag: current selector assigns question to another player
  async assignCatInBag({ sessionId, assigningPlayerId, targetPlayerId }) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);
    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;

    if (!question || session.phase !== 'open' || session.quiz.mode !== 'buzz') {
      throw new Error('No buzz question is open');
    }

    if (state.catInBagPhase !== 'selecting') {
      throw new Error('Not in Cat in the Bag selection phase');
    }

    if (state.boardSelectingPlayerId !== Number(assigningPlayerId)) {
      throw new Error('Only the current selector can assign Cat in the Bag');
    }

    const target = session.players.find((p) => p.id === Number(targetPlayerId));
    if (!target) throw new Error('Target player not found');

    const currentAnswers = await Answer.count({ where: { sessionId, questionId: question.id } });
    const [answer] = await Answer.findOrCreate({
      where: { sessionId, playerId: Number(targetPlayerId), questionId: question.id },
      defaults: { buzzOrder: currentAnswers + 1, submittedAt: new Date() },
    });

    answer.buzzOrder = answer.buzzOrder ?? currentAnswers + 1;
    answer.submittedAt = new Date();
    await answer.save();

    state.catInBagPhase = null;
    state.catInBagTargetPlayerId = Number(targetPlayerId);
    state.currentBuzzPlayerId = Number(targetPlayerId);
    state.buzzAttemptText = '';

    await this.emitState(sessionId);
  }

  async adminAssignCatInBag({ sessionId, targetPlayerId }) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);
    const question = session.quiz.questions[session.currentQuestionIndex] ?? null;

    if (!question || session.phase !== 'open' || session.quiz.mode !== 'buzz') {
      throw new Error('No buzz question is open');
    }

    if (state.catInBagPhase !== 'selecting') {
      throw new Error('Not in Cat in the Bag selection phase');
    }

    const target = session.players.find((p) => p.id === Number(targetPlayerId));
    if (!target) throw new Error('Target player not found');

    const currentAnswers = await Answer.count({ where: { sessionId, questionId: question.id } });
    const [answer] = await Answer.findOrCreate({
      where: { sessionId, playerId: Number(targetPlayerId), questionId: question.id },
      defaults: { buzzOrder: currentAnswers + 1, submittedAt: new Date() },
    });

    answer.buzzOrder = answer.buzzOrder ?? currentAnswers + 1;
    answer.submittedAt = new Date();
    await answer.save();

    state.catInBagPhase = null;
    state.catInBagTargetPlayerId = Number(targetPlayerId);
    state.currentBuzzPlayerId = Number(targetPlayerId);
    state.buzzAttemptText = '';

    await this.emitState(sessionId);
  }

  // Stakes: player submits a wager
  async submitStakesWager({ sessionId, playerId, wager }) {
    const session = await this.getSessionGraph(sessionId);
    const state = await this.ensureState(sessionId);

    if (session.phase !== 'open' || session.quiz.mode !== 'buzz') {
      throw new Error('No buzz question is open');
    }

    if (state.stakesPhase !== 'collecting') {
      throw new Error('Not in stakes wager collection phase');
    }

    const parsedWager = Number(wager);
    if (!Number.isFinite(parsedWager) || parsedWager < 0) {
      throw new Error('Invalid wager amount');
    }

    const playerScore = session.scores.find((s) => s.playerId === Number(playerId))?.points ?? 0;
    const maxWager = Math.max(playerScore, 0);
    const safeWager = Math.min(parsedWager, maxWager);

    state.stakesWagers[Number(playerId)] = safeWager;
    await this.emitState(sessionId);
  }

  // Admin closes stakes wager collection and selects highest bidder
  async closeStakesWager({ sessionId }) {
    const state = await this.ensureState(sessionId);

    if (state.stakesPhase !== 'collecting') {
      throw new Error('Not in stakes wager collection phase');
    }

    // Find highest wagerer
    let maxWager = -1;
    let selectedPlayerId = null;

    for (const [pid, amount] of Object.entries(state.stakesWagers)) {
      if (amount > maxWager) {
        maxWager = amount;
        selectedPlayerId = Number(pid);
      }
    }

    if (selectedPlayerId === null) {
      throw new Error('No wagers submitted');
    }

    state.stakesPhase = 'answering';
    state.stakesSelectedPlayerId = selectedPlayerId;
    await this.emitState(sessionId);
  }

  async kickPlayer(sessionId, playerId) {
    const state = await this.ensureState(sessionId);
    const player = await Player.findOne({ where: { id: playerId, sessionId } });

    if (!player) throw new Error('Player not found');

    if (player.socketId && this.io) {
      this.io.to(player.socketId).emit('player:kicked', { sessionId, playerId });
    }

    if (state.currentBuzzPlayerId === Number(playerId)) {
      state.currentBuzzPlayerId = null;
      state.buzzAttemptText = '';
    }

    if (state.boardSelectingPlayerId === Number(playerId)) {
      state.boardSelectingPlayerId = null;
    }

    await Answer.destroy({ where: { sessionId, playerId } });
    await Score.destroy({ where: { sessionId, playerId } });
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
    const nextAnswerDuration =
      Number.isFinite(parsedAnswerDuration) && parsedAnswerDuration > 0
        ? Math.max(1, Math.round(parsedAnswerDuration))
        : null;
    const hasAnswerDurationChange =
      nextAnswerDuration != null && nextAnswerDuration !== state.sessionAnswerDurationSeconds;

    if (hasAnswerDurationChange) state.sessionAnswerDurationSeconds = nextAnswerDuration;

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

    await this.syncQuestionTimer(sessionId, session, {
      resetCountdown: enabled === true || hasAnswerDurationChange,
    });
    await this.syncAutoAdvance(sessionId, session, {
      resetCountdown: enabled === true || hasDurationChange,
    });
    await this.emitState(sessionId);
    return this.getAdminSession(sessionId);
  }

  async deleteSession(sessionId) {
    const session = await GameSession.findByPk(sessionId);
    if (!session) throw new Error('Session not found');

    this.clearRuntimeState(sessionId);
    await session.destroy();
  }

  async deleteSessionsForQuiz(quizId) {
    const sessions = await GameSession.findAll({ where: { quizId }, attributes: ['id'] });
    for (const session of sessions) {
      this.clearRuntimeState(session.id);
    }
    await GameSession.destroy({ where: { quizId } });
  }

  async getSessionByJoinCode(joinCode, viewerPlayerId = null) {
    const session = await GameSession.findOne({ where: { joinCode: joinCode.toUpperCase() } });
    if (!session) throw new Error('Session not found');

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

module.exports = { SessionRuntimeService };
