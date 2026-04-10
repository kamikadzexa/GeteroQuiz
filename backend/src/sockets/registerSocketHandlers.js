const { verifyAdminToken } = require('../services/authService');
const { User } = require('../models');
const { getSessionQuizForRequest } = require('../services/quizAccessService');

function registerSocketHandlers(io, runtimeService) {
  io.on('connection', (socket) => {
    socket.on('join-player-session', async (payload, callback) => {
      try {
        const { sessionId, playerId } = payload;
        await runtimeService.attachPlayerSocket(sessionId, playerId, socket.id);
        socket.data.sessionId = sessionId;
        socket.data.playerId = playerId;
        socket.data.role = 'player';
        socket.join(runtimeService.getRoom(sessionId));
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error.message });
      }
    });

    socket.on('join-admin-session', async (payload, callback) => {
      try {
        const { sessionId, token } = payload;
        const admin = verifyAdminToken(token);
        const user = await User.findByPk(admin.sub);
        if (!user || user.status !== 'active' || !['admin', 'editor'].includes(user.role)) {
          throw new Error('Your account does not have access yet');
        }
        await getSessionQuizForRequest(
          { headers: { 'x-quiz-pin': payload.quizPin || '' }, body: payload },
          sessionId,
        );
        socket.data.sessionId = sessionId;
        socket.data.role = 'admin';
        socket.join(runtimeService.getAdminRoom(sessionId));
        await runtimeService.emitState(sessionId);
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error.message });
      }
    });

    socket.on('join-display-session', async (payload, callback) => {
      try {
        const { sessionId } = payload;
        socket.data.sessionId = sessionId;
        socket.data.role = 'display';
        socket.join(runtimeService.getRoom(sessionId));
        await runtimeService.emitState(sessionId);
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error.message });
      }
    });

    socket.on('player:submit-answer', async (payload, callback) => {
      try {
        await runtimeService.submitClassicAnswer({
          sessionId: payload.sessionId,
          playerId: payload.playerId,
          value: payload.value,
        });
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error.message });
      }
    });

    socket.on('player:buzz', async (payload, callback) => {
      try {
        await runtimeService.buzzIn({ sessionId: payload.sessionId, playerId: payload.playerId });
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error.message });
      }
    });

    socket.on('player:buzz-answer', async (payload, callback) => {
      try {
        await runtimeService.submitBuzzAttempt({
          sessionId: payload.sessionId,
          playerId: payload.playerId,
          value: payload.value,
        });
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error.message });
      }
    });

    // Real-time buzz answer text streaming
    socket.on('player:buzz-text-update', async (payload) => {
      try {
        await runtimeService.updateBuzzAnswerLive({
          sessionId: payload.sessionId,
          playerId: payload.playerId,
          text: payload.text,
        });
      } catch {
        // Silently ignore streaming errors
      }
    });

    // Board mode: player selects a question tile
    socket.on('player:select-question', async (payload, callback) => {
      try {
        await runtimeService.selectBoardQuestion({
          sessionId: payload.sessionId,
          playerId: payload.playerId,
          questionId: payload.questionId,
        });
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error.message });
      }
    });

    // Cat in the Bag: assign question to another player
    socket.on('player:cib-assign', async (payload, callback) => {
      try {
        await runtimeService.assignCatInBag({
          sessionId: payload.sessionId,
          assigningPlayerId: payload.assigningPlayerId,
          targetPlayerId: payload.targetPlayerId,
        });
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error.message });
      }
    });

    // Stakes: player submits a wager
    socket.on('player:stakes-wager', async (payload, callback) => {
      try {
        await runtimeService.submitStakesWager({
          sessionId: payload.sessionId,
          playerId: payload.playerId,
          wager: payload.wager,
        });
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error.message });
      }
    });

    socket.on('disconnect', async () => {
      if (socket.data.role === 'player') {
        await runtimeService.disconnectPlayer(socket.id);
      }
    });
  });
}

module.exports = { registerSocketHandlers };
