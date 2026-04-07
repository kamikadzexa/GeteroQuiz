const { GameSession, Player, Quiz } = require('../models');
const { getQuizForRequest, getSessionQuizForRequest, quizHasEditorPin } = require('../services/quizAccessService');

async function listSessions(_req, res, next) {
  try {
    const sessions = await GameSession.findAll({
      include: [
        { model: Quiz, as: 'quiz' },
        { model: Player, as: 'players' },
      ],
      order: [['createdAt', 'DESC']],
    });

    return res.json(
      sessions.map((session) => ({
        id: session.id,
        joinCode: session.joinCode,
        status: session.status,
        phase: session.phase,
        currentQuestionIndex: session.currentQuestionIndex,
        playerCount: session.players.length,
        createdAt: session.createdAt,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        quiz: {
          id: session.quiz.id,
          title: session.quiz.title,
          mode: session.quiz.mode,
          accentColor: session.quiz.accentColor,
          hasEditorPin: quizHasEditorPin(session.quiz),
        },
      })),
    );
  } catch (error) {
    return next(error);
  }
}

async function listPublicSessions(req, res, next) {
  try {
    const sessions = await req.app.locals.runtimeService.listPublicSessions();
    return res.json(sessions);
  } catch (error) {
    return next(error);
  }
}

async function createSession(req, res, next) {
  try {
    await getQuizForRequest(req, req.body.quizId);
    const session = await req.app.locals.runtimeService.createSession(req.body.quizId);
    return res.status(201).json({
      id: session.id,
      joinCode: session.joinCode,
      status: session.status,
      phase: session.phase,
      quiz: {
        id: session.quiz.id,
        title: session.quiz.title,
        mode: session.quiz.mode,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getPublicSession(req, res, next) {
  try {
    const state = await req.app.locals.runtimeService.getSessionByJoinCode(
      req.params.joinCode,
      req.query.playerId || null,
    );
    return res.json(state);
  } catch (error) {
    return next(error);
  }
}

async function getAdminSession(req, res, next) {
  try {
    await getSessionQuizForRequest(req, req.params.sessionId);
    const state = await req.app.locals.runtimeService.getAdminSession(req.params.sessionId);
    return res.json(state);
  } catch (error) {
    return next(error);
  }
}

async function joinSession(req, res, next) {
  try {
    const { session, player } = await req.app.locals.runtimeService.joinPlayer({
      joinCode: req.params.joinCode,
      displayName: req.body.displayName,
      avatar: req.body.avatar,
      preferredLanguage: req.body.preferredLanguage,
    });

    return res.status(201).json({
      player: {
        id: player.id,
        playerId: player.id,
        displayName: player.displayName,
        avatar: player.avatar,
        preferredLanguage: player.preferredLanguage,
        playerCode: player.rejoinCode,
        joinCode: session.joinCode,
        sessionId: session.id,
      },
      session: await req.app.locals.runtimeService.getSessionByJoinCode(session.joinCode, player.id),
    });
  } catch (error) {
    return next(error);
  }
}

async function rejoinSession(req, res, next) {
  try {
    const { session, player } = await req.app.locals.runtimeService.rejoinPlayer({
      joinCode: req.params.joinCode,
      playerCode: req.body.playerCode,
    });

    return res.json({
      player: {
        id: player.id,
        playerId: player.id,
        displayName: player.displayName,
        avatar: player.avatar,
        preferredLanguage: player.preferredLanguage,
        playerCode: player.rejoinCode,
        joinCode: session.joinCode,
        sessionId: session.id,
      },
      session: await req.app.locals.runtimeService.getSessionByJoinCode(session.joinCode, player.id),
    });
  } catch (error) {
    return next(error);
  }
}

async function advanceSession(req, res, next) {
  try {
    await getSessionQuizForRequest(req, req.params.sessionId);
    const session = await req.app.locals.runtimeService.advanceQuestion(req.params.sessionId);
    return res.json({
      id: session.id,
      status: session.status,
      phase: session.phase,
      currentQuestionIndex: session.currentQuestionIndex,
    });
  } catch (error) {
    return next(error);
  }
}

async function closeQuestion(req, res, next) {
  try {
    await getSessionQuizForRequest(req, req.params.sessionId);
    const session = await req.app.locals.runtimeService.closeActiveQuestion(req.params.sessionId);
    return res.json({
      id: session.id,
      status: session.status,
      phase: session.phase,
      currentQuestionIndex: session.currentQuestionIndex,
    });
  } catch (error) {
    return next(error);
  }
}

async function finishSession(req, res, next) {
  try {
    await getSessionQuizForRequest(req, req.params.sessionId);
    const session = await req.app.locals.runtimeService.finishSession(req.params.sessionId);
    return res.json({
      id: session.id,
      status: session.status,
      phase: session.phase,
      currentQuestionIndex: session.currentQuestionIndex,
    });
  } catch (error) {
    return next(error);
  }
}

async function replayQuestion(req, res, next) {
  try {
    await getSessionQuizForRequest(req, req.params.sessionId);
    const session = await req.app.locals.runtimeService.replayQuestion(req.params.sessionId);
    return res.json({
      id: session.id,
      status: session.status,
      phase: session.phase,
      currentQuestionIndex: session.currentQuestionIndex,
    });
  } catch (error) {
    return next(error);
  }
}

async function judgeAnswer(req, res, next) {
  try {
    await getSessionQuizForRequest(req, req.params.sessionId);
    const answer = await req.app.locals.runtimeService.judgeAnswer({
      answerId: req.params.answerId,
      isCorrect: Boolean(req.body.isCorrect),
    });

    return res.json(answer);
  } catch (error) {
    return next(error);
  }
}

async function judgeBuzz(req, res, next) {
  try {
    await getSessionQuizForRequest(req, req.params.sessionId);
    const answer = await req.app.locals.runtimeService.judgeBuzz({
      sessionId: req.params.sessionId,
      isCorrect: Boolean(req.body.isCorrect),
    });

    return res.json(answer);
  } catch (error) {
    return next(error);
  }
}

async function assistPlayer(req, res, next) {
  try {
    await getSessionQuizForRequest(req, req.params.sessionId);
    const state = await req.app.locals.runtimeService.getAdminSession(req.params.sessionId);
    const player = state.players.find((item) => item.id === Number(req.params.playerId));

    if (!player) {
      return res.status(404).json({ message: 'Player not found' });
    }

    return res.json(player);
  } catch (error) {
    return next(error);
  }
}

async function kickPlayer(req, res, next) {
  try {
    await getSessionQuizForRequest(req, req.params.sessionId);
    await req.app.locals.runtimeService.kickPlayer(req.params.sessionId, req.params.playerId);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
}

async function updateAutoAdvance(req, res, next) {
  try {
    await getSessionQuizForRequest(req, req.params.sessionId);
    const state = await req.app.locals.runtimeService.updateAutoAdvance(req.params.sessionId, {
      enabled: req.body.enabled,
      paused: req.body.paused,
      durationSeconds: req.body.durationSeconds,
      answerDurationSeconds: req.body.answerDurationSeconds,
    });
    return res.json(state);
  } catch (error) {
    return next(error);
  }
}

async function deleteSession(req, res, next) {
  try {
    await getSessionQuizForRequest(req, req.params.sessionId);
    await req.app.locals.runtimeService.deleteSession(req.params.sessionId);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listSessions,
  listPublicSessions,
  createSession,
  getPublicSession,
  getAdminSession,
  joinSession,
  rejoinSession,
  advanceSession,
  closeQuestion,
  finishSession,
  replayQuestion,
  judgeAnswer,
  judgeBuzz,
  assistPlayer,
  kickPlayer,
  updateAutoAdvance,
  deleteSession,
};
