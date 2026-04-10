const express = require('express');
const {
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
  adjustScore,
  assignBoardSelector,
  selectBoardQuestion,
  assignCatInBag,
  closeStakesWager,
} = require('../controllers/sessionController');
const { requireStaff } = require('../middleware/auth');

const router = express.Router();

router.get('/public-active', listPublicSessions);
router.get('/by-code/:joinCode', getPublicSession);
router.post('/:joinCode/join', joinSession);
router.post('/:joinCode/rejoin', rejoinSession);

router.get('/admin', requireStaff, listSessions);
router.post('/', requireStaff, createSession);
router.get('/:sessionId/admin', requireStaff, getAdminSession);
router.post('/:sessionId/advance', requireStaff, advanceSession);
router.post('/:sessionId/close', requireStaff, closeQuestion);
router.post('/:sessionId/finish', requireStaff, finishSession);
router.post('/:sessionId/replay', requireStaff, replayQuestion);
router.post('/:sessionId/auto-advance', requireStaff, updateAutoAdvance);
router.post('/:sessionId/answers/:answerId/judge', requireStaff, judgeAnswer);
router.post('/:sessionId/buzz/judge', requireStaff, judgeBuzz);
router.post('/:sessionId/board/assign-selector', requireStaff, assignBoardSelector);
router.post('/:sessionId/board/select-question', requireStaff, selectBoardQuestion);
router.post('/:sessionId/board/assign-cat-in-bag', requireStaff, assignCatInBag);
router.post('/:sessionId/board/close-stakes', requireStaff, closeStakesWager);
router.post('/:sessionId/players/:playerId/adjust-score', requireStaff, adjustScore);
router.get('/:sessionId/players/:playerId', requireStaff, assistPlayer);
router.delete('/:sessionId/players/:playerId', requireStaff, kickPlayer);
router.delete('/:sessionId', requireStaff, deleteSession);

module.exports = router;
