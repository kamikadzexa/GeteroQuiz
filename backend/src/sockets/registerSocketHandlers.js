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
          {
            headers: { 'x-quiz-pin': payload.quizPin || '' },
            body: payload,
          },
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
        await runtimeService.buzzIn({
          sessionId: payload.sessionId,
          playerId: payload.playerId,
        });
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

    socket.on('disconnect', async () => {
      if (socket.data.role === 'player') {
        await runtimeService.disconnectPlayer(socket.id);
      }
    });
  });
}

module.exports = {
  registerSocketHandlers,
};
