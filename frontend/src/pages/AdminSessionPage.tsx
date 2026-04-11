import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BuzzBoard } from '../components/shared/BuzzBoard'
import { LeaderboardCard } from '../components/shared/LeaderboardCard'
import { QuestionMedia } from '../components/shared/QuestionMedia'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../context/I18nContext'
import { useCountdown } from '../hooks/useCountdown'
import { api, assetUrl, getStoredSessionPin, setStoredSessionPin } from '../services/api'
import { getSocket } from '../services/socket'
import type { AdminSessionState } from '../types'
import { withSessionPin } from '../utils/quizPin'

function PlayerAvatar({ avatar, name }: { avatar: string; name: string }) {
  if (avatar.startsWith('emoji:')) {
    return <span className="avatar emoji" style={{ width: '2rem', height: '2rem', fontSize: '1rem' }}>{avatar.replace('emoji:', '')}</span>
  }
  return <img alt={name} className="avatar" src={assetUrl(avatar)} style={{ width: '2rem', height: '2rem' }} />
}

function CorrectAnswerPanel({
  title,
  answer,
  mediaType,
  mediaUrl,
}: {
  title: string
  answer: string | null
  mediaType: 'none' | 'image' | 'audio' | 'video'
  mediaUrl: string
}) {
  if (!answer && (!mediaType || mediaType === 'none' || !mediaUrl)) return null

  return (
    <div className="answer-reveal-panel">
      <div>
        <span className="eyebrow">{title}</span>
        <p className="correct-answer-text">{answer || '-'}</p>
      </div>
      {mediaType && mediaType !== 'none' && mediaUrl ? (
        <div className="media-block answer-reveal-media">
          {mediaType === 'image' ? (
            <img alt="Correct answer" className="media-visual" src={mediaUrl} style={{ width: '100%', objectFit: 'contain' }} />
          ) : mediaType === 'video' ? (
            <video className="media-visual" controls src={mediaUrl} style={{ width: '100%' }} />
          ) : (
            <audio controls src={mediaUrl} style={{ width: '100%' }} />
          )}
        </div>
      ) : null}
    </div>
  )
}

export function AdminSessionPage() {
  const { t } = useI18n()
  const { sessionId = '' } = useParams()
  const { token, user, loading } = useAuth()
  const [sessionState, setSessionState] = useState<AdminSessionState | null>(null)
  const [answerInput, setAnswerInput] = useState('60')
  const [durationInput, setDurationInput] = useState('15')
  const [error, setError] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [scoreAdjusts, setScoreAdjusts] = useState<Record<number, string>>({})
  const [liveBuzzText, setLiveBuzzText] = useState('')
  const liveBuzzTextRef = useRef('')

  const sessionHasStarted = (sessionState?.status === 'live' || (sessionState?.currentQuestionIndex ?? -1) >= 0) ?? false
  const timerEnabled = Boolean(sessionState?.autoAdvanceEnabled)
  const timerPaused = Boolean(sessionState?.autoAdvancePaused)
  const inReview = sessionState?.phase === 'review'
  const timerCounting = timerEnabled && inReview && !timerPaused
  const isBuzzMode = sessionState?.mode === 'buzz'

  const questionSecondsLeft = useCountdown(
    sessionState?.phase === 'open' ? sessionState.closesAt : null,
    sessionState?.serverNow ?? null,
  )
  const autoCountdownLeft = useCountdown(
    timerCounting ? (sessionState?.autoAdvanceAt ?? null) : null,
    sessionState?.serverNow ?? null,
  )

  const answerDuration = sessionState?.answerDurationSeconds ?? 60
  const advanceDuration = sessionState?.autoAdvanceDurationSeconds ?? 15
  const answerCountdown = sessionState?.phase === 'open'
    ? (sessionState.closesAt ? questionSecondsLeft : sessionState.questionRemainingSeconds)
    : answerDuration
  const answerProgress = sessionState?.phase === 'open' && answerDuration > 0
    ? Math.max(0, Math.min(100, (answerCountdown / answerDuration) * 100))
    : 0
  const advanceCountdown = sessionState?.autoAdvanceAt
    ? autoCountdownLeft
    : (sessionState?.autoAdvanceRemainingSeconds ?? advanceDuration)
  const advanceProgress = (timerCounting || timerPaused) && inReview && advanceDuration > 0
    ? Math.max(0, Math.min(100, (advanceCountdown / advanceDuration) * 100))
    : 0
  const answerTone = answerProgress > 60 ? 'safe' : answerProgress > 30 ? 'warn' : 'danger'
  const advanceTone = advanceProgress > 60 ? 'safe' : advanceProgress > 30 ? 'warn' : 'danger'

  async function refresh() {
    if (!token) return
    const nextState = await api.getAdminSession(token, sessionId, getStoredSessionPin(sessionId) || undefined)
    setSessionState(nextState)
  }

  function parseDuration(val: string): number | null {
    const n = Number(val.trim())
    if (!Number.isFinite(n) || n <= 0) return null
    return Math.max(1, Math.round(n))
  }

  async function saveAnswerDuration(val?: string) {
    if (!token || !sessionState || actionBusy) return
    const duration = parseDuration(val ?? answerInput)
    if (duration == null) { setAnswerInput(String(sessionState.answerDurationSeconds)); setError('Answer time must be a positive number'); return }
    if (duration === sessionState.answerDurationSeconds) { setAnswerInput(String(duration)); return }
    setActionBusy(true)
    try {
      setError('')
      const next = await api.updateAutoAdvance(token, sessionState.id, { answerDurationSeconds: duration }, getStoredSessionPin(sessionId) || undefined)
      setSessionState(next)
      setAnswerInput(String(next.answerDurationSeconds))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update timer')
      setAnswerInput(String(sessionState.answerDurationSeconds))
    } finally { setActionBusy(false) }
  }

  async function saveDuration(val?: string) {
    if (!token || !sessionState || actionBusy) return
    const duration = parseDuration(val ?? durationInput)
    if (duration == null) { setDurationInput(String(sessionState.autoAdvanceDurationSeconds)); setError('Advance time must be a positive number'); return }
    if (duration === sessionState.autoAdvanceDurationSeconds) { setDurationInput(String(duration)); return }
    setActionBusy(true)
    try {
      setError('')
      const next = await api.updateAutoAdvance(token, sessionState.id, { durationSeconds: duration }, getStoredSessionPin(sessionId) || undefined)
      setSessionState(next)
      setDurationInput(String(next.autoAdvanceDurationSeconds))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update timer')
      setDurationInput(String(sessionState.autoAdvanceDurationSeconds))
    } finally { setActionBusy(false) }
  }

  async function toggleTimer() {
    if (!token || !sessionState || actionBusy) return
    setActionBusy(true)
    try {
      setError('')
      const next = await api.updateAutoAdvance(token, sessionState.id, { enabled: !timerEnabled }, getStoredSessionPin(sessionId) || undefined)
      setSessionState(next)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update timer') }
    finally { setActionBusy(false) }
  }

  async function togglePause() {
    if (!token || !sessionState || actionBusy) return
    setActionBusy(true)
    try {
      setError('')
      const next = await api.updateAutoAdvance(token, sessionState.id, { paused: !timerPaused }, getStoredSessionPin(sessionId) || undefined)
      setSessionState(next)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update timer') }
    finally { setActionBusy(false) }
  }

  async function toggleMediaAutoplay() {
    if (!token || !sessionState || actionBusy) return
    setActionBusy(true)
    try {
      setError('')
      const next = await api.updateMediaAutoplay(token, sessionState.id, !sessionState.mediaAutoplayEnabled, getStoredSessionPin(sessionId) || undefined)
      setSessionState(next)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update media autoplay') }
    finally { setActionBusy(false) }
  }

  async function triggerHostAction(action: 'advance' | 'close' | 'replay' | 'finish') {
    if (!token || !sessionState || actionBusy) return
    try {
      setActionBusy(true)
      setError('')
      const quizPin = getStoredSessionPin(sessionId) || undefined
      if (action === 'advance') await api.advanceSession(token, sessionState.id, quizPin)
      if (action === 'close') await api.closeQuestion(token, sessionState.id, quizPin)
      if (action === 'replay') await api.replayQuestion(token, sessionState.id, quizPin)
      if (action === 'finish') await api.finishSession(token, sessionState.id, quizPin)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not update session')
    } finally { setActionBusy(false) }
  }

  async function handleJudgeBuzz(isCorrect: boolean) {
    if (!token || !sessionState) return
    try {
      setError('')
      await api.judgeBuzz(token, sessionState.id, isCorrect, getStoredSessionPin(sessionId) || undefined)
      setLiveBuzzText('')
      liveBuzzTextRef.current = ''
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not judge') }
  }

  async function handleAdjustScore(playerId: number) {
    if (!token || !sessionState) return
    const raw = scoreAdjusts[playerId] || ''
    const delta = Number(raw)
    if (!Number.isFinite(delta) || delta === 0) { setError('Enter a valid non-zero number'); return }
    try {
      setError('')
      await api.adjustScore(token, sessionState.id, playerId, delta, getStoredSessionPin(sessionId) || undefined)
      setScoreAdjusts((prev) => ({ ...prev, [playerId]: '' }))
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not adjust score') }
  }

  async function handleAssignSelector(playerId: number) {
    if (!token || !sessionState) return
    try {
      setError('')
      await api.assignBoardSelector(token, sessionState.id, playerId, getStoredSessionPin(sessionId) || undefined)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not assign selector') }
  }

  async function handleAdminSelectQuestion(questionId: number) {
    if (!token || !sessionState) return
    try {
      setError('')
      await api.selectBoardQuestion(token, sessionState.id, questionId, getStoredSessionPin(sessionId) || undefined)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not select question') }
  }

  async function handleAdminAssignCatInBag(playerId: number) {
    if (!token || !sessionState) return
    try {
      setError('')
      await api.assignCatInBag(token, sessionState.id, playerId, getStoredSessionPin(sessionId) || undefined)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not assign player') }
  }

  async function handleCloseStakes() {
    if (!token || !sessionState) return
    try {
      setError('')
      await api.closeStakesWager(token, sessionState.id, getStoredSessionPin(sessionId) || undefined)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not close stakes') }
  }

  useEffect(() => {
    if (!token) return
    const socket = getSocket()
    const sync = (payload: AdminSessionState) => {
      setSessionState(payload)
      // Keep live text in sync with server state if no local update is pending
      if (payload.activeBuzzPlayerId == null) {
        setLiveBuzzText('')
        liveBuzzTextRef.current = ''
      }
    }

    const onBuzzText = (payload: { playerId: number; text: string }) => {
      setLiveBuzzText(payload.text)
      liveBuzzTextRef.current = payload.text
    }

    if (!socket.connected) socket.connect()

    void withSessionPin(
      sessionId,
      undefined,
      async (quizPin) => {
        if (quizPin) setStoredSessionPin(sessionId, quizPin)
        const nextState = await api.getAdminSession(token, sessionId, quizPin)
        setSessionState(nextState)
        socket.emit(
          'join-admin-session',
          { sessionId: Number(sessionId), token, quizPin: quizPin || undefined },
          (result: { ok: boolean; message?: string }) => {
            if (!result?.ok) setError(result?.message || 'Could not connect to admin session')
          },
        )
      },
      t('editor.sessionPinPrompt'),
    ).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load session')
    })

    socket.on('admin:state', sync)
    socket.on('admin:buzz-text', onBuzzText)

    return () => {
      socket.off('admin:state', sync)
      socket.off('admin:buzz-text', onBuzzText)
    }
  }, [sessionId, t, token])

  useEffect(() => {
    if (!sessionState) return
    setAnswerInput(String(sessionState.answerDurationSeconds))
  }, [sessionState?.answerDurationSeconds])

  useEffect(() => {
    if (!sessionState) return
    setDurationInput(String(sessionState.autoAdvanceDurationSeconds))
  }, [sessionState?.autoAdvanceDurationSeconds])

  if (loading) return <section className="panel">{t('common.loading')}</section>

  if (!user || !token) {
    return (
      <section className="panel">
        <Link className="ghost-button" to="/admin">{t('admin.loginAction')}</Link>
      </section>
    )
  }

  if (!sessionState) return <section className="panel">{error || t('common.loading')}</section>

  const activeBuzzPlayerId = sessionState.activeBuzzPlayerId
  const activeBuzzPlayer = activeBuzzPlayerId != null
    ? sessionState.players.find((p) => p.id === activeBuzzPlayerId) ?? null
    : null
  const activeBuzzAnswer = sessionState.answers.find((a) => a.playerId === activeBuzzPlayerId)
  const displayUrl = `${window.location.origin}/display/${sessionState.joinCode}`
  const boardSelectorPlayer = sessionState.boardSelectingPlayerId != null
    ? sessionState.players.find((p) => p.id === sessionState.boardSelectingPlayerId) ?? null
    : null
  const showAdminBoard = isBuzzMode && sessionState.status === 'live' && sessionState.phase === 'waiting'
  const showCatInBagAdminPicker = isBuzzMode
    && sessionState.catInBagPhase === 'selecting'
    && sessionState.currentQuestion?.specialType === 'cat_in_bag'

  return (
    <div className="admin-session-layout">
      {/* ─── Buzz answer popup/modal ─── */}
      {isBuzzMode && activeBuzzPlayer ? (
        <div className="modal-backdrop">
          <div className="modal-panel">
            <div className="inline-header">
              <h2>{t('admin.buzzPopupTitle')}</h2>
              <span className="chip active">{activeBuzzPlayer.displayName}</span>
            </div>
            <div className="buzz-live-text-box">
              <span className="eyebrow">{t('admin.buzzPopupLiveText')}</span>
              <p className="buzz-live-text">
                {liveBuzzText || (activeBuzzAnswer?.submittedAnswer) || (
                  <em style={{ color: 'var(--muted)' }}>{t('admin.buzzPopupNoText')}</em>
                )}
              </p>
            </div>
            {/* Correct answer for admin */}
            <CorrectAnswerPanel
              answer={sessionState.correctAnswer}
              mediaType={sessionState.correctAnswerMediaType}
              mediaUrl={sessionState.correctAnswerMediaUrl}
              title={t('admin.correctAnswer')}
            />
            <div className="action-row">
              <button
                className="cta-button secondary"
                onClick={() => { void handleJudgeBuzz(true) }}
                type="button"
              >
                {t('admin.correct')}
              </button>
              <button
                className="ghost-button"
                onClick={() => { void handleJudgeBuzz(false) }}
                type="button"
              >
                {t('admin.wrong')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── Main control panel ─── */}
      <section className="panel">
        <div className="inline-header">
          <div>
            <span className="eyebrow">{t('admin.sessionControl')}</span>
            <h1>{sessionState.title}</h1>
          </div>
          <div className="action-row">
            <Link className="ghost-button" to="/admin">{t('editor.back')}</Link>
            <button className="ghost-button" onClick={() => { void refresh() }} type="button">{t('admin.refresh')}</button>
          </div>
        </div>

        <div className="session-header-grid">
          <div className="helper-banner">
            <div>
              <strong>{t('admin.shareCode')}</strong>
              <span>{sessionState.joinCode}</span>
            </div>
          </div>
          <div className="helper-banner">
            <div>
              <strong>{t('admin.players')}</strong>
              <span>{sessionState.playerCount} / {sessionState.connectedPlayerCount}</span>
            </div>
          </div>
          <div className="helper-banner">
            <div>
              <strong>{t('play.questionCounter')}</strong>
              <span>{Math.max(sessionState.currentQuestionIndex + 1, 0)} / {sessionState.totalQuestions}</span>
            </div>
          </div>
          <div className="helper-banner display-link-banner">
            <div>
              <strong>{t('admin.displayMode')}</strong>
              <span className="display-link-text">{displayUrl}</span>
            </div>
            <div className="action-row">
              <a className="ghost-button" href={displayUrl} rel="noreferrer" target="_blank">{t('admin.openDisplay')}</a>
              <button
                className="ghost-button"
                onClick={async () => { try { await navigator.clipboard.writeText(displayUrl) } catch { setError(t('admin.copyFailed')) } }}
                type="button"
              >{t('admin.copyDisplayLink')}</button>
            </div>
          </div>
        </div>

        <div className="admin-control-grid">
          <button className="cta-button" disabled={actionBusy} onClick={() => { void triggerHostAction('advance') }} type="button">
            {sessionHasStarted ? t('admin.openNextQuestion') : t('admin.startSession')}
          </button>
          <button className="ghost-button" disabled={actionBusy} onClick={() => { void triggerHostAction('close') }} type="button">
            {t('admin.closeQuestion')}
          </button>
          <button className="ghost-button" disabled={actionBusy} onClick={() => { void triggerHostAction('replay') }} type="button">
            {t('admin.replayQuestion')}
          </button>
          <button className="ghost-button" disabled={actionBusy} onClick={() => { void triggerHostAction('finish') }} type="button">
            {t('admin.finishSession')}
          </button>
          <button
            className={sessionState.mediaAutoplayEnabled ? 'ghost-button' : 'cta-button secondary'}
            disabled={actionBusy}
            onClick={() => { void toggleMediaAutoplay() }}
            type="button"
          >
            {sessionState.mediaAutoplayEnabled ? t('admin.pauseOnDisplay') : t('admin.playOnDisplay')}
          </button>
        </div>

        {/* Board mode: selector status + stakes close */}
        {isBuzzMode && sessionState.status === 'live' ? (
          <div className="board-status-bar">
            <div>
              <span className="eyebrow">{t('admin.boardSelector')}</span>
              <span style={{ marginLeft: '0.6rem', fontWeight: 600 }}>
                {boardSelectorPlayer ? boardSelectorPlayer.displayName : <em style={{ color: 'var(--muted)', fontWeight: 400 }}>{t('admin.noSelector')}</em>}
              </span>
            </div>
            {sessionState.stakesPhase === 'collecting' ? (
              <button className="ghost-button" onClick={() => { void handleCloseStakes() }} type="button">
                {t('admin.closeStakes')}
              </button>
            ) : null}
          </div>
        ) : null}

        {showAdminBoard ? (
          <div className="automation-card admin-board-card">
            <div className="inline-header">
              <div>
                <strong>{t('admin.boardControl')}</strong>
                <p className="helper-text">{t('admin.boardControlHint')}</p>
              </div>
              {sessionState.upcomingRoundName ? <span className="round-label">{sessionState.upcomingRoundName}</span> : null}
            </div>
            <BuzzBoard
              allowDirectSelect
              answeredIds={sessionState.boardAnsweredQuestionIds}
              columns={sessionState.boardColumns}
              emptyHint={t('admin.boardControlHint')}
              isWaiting
              onSelectTile={(questionId) => { void handleAdminSelectQuestion(questionId) }}
              selectingHint={boardSelectorPlayer ? `${boardSelectorPlayer.displayName} is selecting...` : undefined}
              selectingPlayerId={sessionState.boardSelectingPlayerId}
              viewerPlayerId={null}
              viewerScore={0}
              yourTurnHint={t('admin.openNextQuestion')}
            />
          </div>
        ) : null}

        {showCatInBagAdminPicker ? (
          <div className="special-phase-panel">
            <div className="inline-header">
              <div>
                <strong>{t('admin.catInBagAssignTitle')}</strong>
                <p className="helper-text">{t('admin.catInBagAssignHint')}</p>
              </div>
              {sessionState.currentQuestion?.roundName ? <span className="round-label">{sessionState.currentQuestion.roundName}</span> : null}
            </div>
            <div className="cib-player-grid">
              {sessionState.players.map((player) => (
                <button
                  className="ghost-button cib-player-btn"
                  key={player.id}
                  onClick={() => { void handleAdminAssignCatInBag(player.id) }}
                  type="button"
                >
                  {player.displayName}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="automation-card">
          <div className="inline-header">
            <div>
              <strong>{t('admin.autoTimer')}</strong>
              <p className="helper-text">{t('admin.autoTimerHint')}</p>
            </div>
            <span className={timerCounting ? 'chip active' : 'chip'}>
              {timerEnabled ? timerPaused ? t('admin.paused') : timerCounting ? `${t('admin.nextQuestionIn')} ${autoCountdownLeft}s` : t('admin.running') : t('admin.off')}
            </span>
          </div>

          <div className={`session-timer-block${sessionState.phase === 'open' ? `${timerPaused ? ' paused' : ` timer-${answerTone}`}` : ''}`} style={{ marginBottom: 0 }}>
            <div className="inline-header">
              <strong>{t('admin.answerTimer')}</strong>
              <span>{answerCountdown}s</span>
            </div>
            <div className="session-timer-track">
              <div className="session-timer-fill" style={{ width: `${answerProgress}%` }} />
            </div>
            <label style={{ display: 'grid', gap: '0.4rem', color: 'var(--muted)' }}>
              <span>{t('editor.timer')}</span>
              <input
                inputMode="numeric" min={1}
                onBlur={() => { void saveAnswerDuration() }}
                onChange={(e) => setAnswerInput(e.target.value)}
                onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); void saveAnswerDuration((e.target as HTMLInputElement).value) }}
                type="number" value={answerInput}
              />
            </label>
          </div>

          <div className={`session-timer-block${timerPaused ? ' paused' : (timerCounting ? ` timer-${advanceTone}` : '')}`} style={{ marginBottom: 0 }}>
            <div className="inline-header">
              <strong>{t('admin.advanceTimer')}</strong>
              <span>{inReview ? advanceCountdown : advanceDuration}s</span>
            </div>
            <div className="session-timer-track">
              <div className="session-timer-fill" style={{ width: `${advanceProgress}%` }} />
            </div>
            <div className="automation-grid">
              <label>
                <span>{t('editor.timer')}</span>
                <input
                  inputMode="numeric" min={1}
                  onBlur={() => { void saveDuration() }}
                  onChange={(e) => setDurationInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); void saveDuration((e.target as HTMLInputElement).value) }}
                  type="number" value={durationInput}
                />
              </label>
              <button className="cta-button secondary" disabled={actionBusy} onClick={() => { void toggleTimer() }} type="button">
                {timerEnabled ? t('admin.stopAutoTimer') : t('admin.startAutoTimer')}
              </button>
              <button className="ghost-button" disabled={!timerEnabled || !sessionHasStarted || actionBusy} onClick={() => { void togglePause() }} type="button">
                {timerPaused ? t('admin.resume') : t('admin.pause')}
              </button>
            </div>
          </div>
        </div>

        {sessionState.currentQuestion ? (
          <div className="question-card">
            <span className="eyebrow">{sessionState.mode.toUpperCase()}{sessionState.currentQuestion.specialType && sessionState.currentQuestion.specialType !== 'normal' ? ` · ${sessionState.currentQuestion.specialType.replace('_', ' ').toUpperCase()}` : ''}</span>
            {sessionState.currentQuestion.roundName ? <span className="round-label">{sessionState.currentQuestion.roundName}</span> : null}
            <h2>{sessionState.currentQuestion.prompt}</h2>
            {sessionState.currentQuestion.helpText ? <p className="helper-text">{sessionState.currentQuestion.helpText}</p> : null}
            <QuestionMedia autoplay={false} question={sessionState.currentQuestion} />
            <div className="pill-row">
              <span className="chip">{sessionState.phase}</span>
              <span className="chip">{sessionState.answerCount} answers</span>
              <span className="chip">{sessionState.currentQuestion.points} pts</span>
            </div>
            {/* Correct answer always visible to admin */}
            <CorrectAnswerPanel
              answer={sessionState.correctAnswer}
              mediaType={sessionState.correctAnswerMediaType}
              mediaUrl={sessionState.correctAnswerMediaUrl}
              title={t('admin.correctAnswer')}
            />
          </div>
        ) : (
          <div className="question-card waiting-card">
            <h2>{t('admin.noSessionSelected')}</h2>
          </div>
        )}
      </section>

      {/* ─── Players panel ─── */}
      <section className="panel">
        <div className="inline-header">
          <h2>{t('admin.players')}</h2>
          <span className="chip">{sessionState.joinCode}</span>
        </div>

        {/* Stakes wagers display */}
        {isBuzzMode && sessionState.stakesPhase && Object.keys(sessionState.stakesWagers).length > 0 ? (
          <div className="stakes-wager-list">
            <strong style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>{t('admin.stakesWagers')}</strong>
            {Object.entries(sessionState.stakesWagers).map(([pid, amount]) => {
              const p = sessionState.players.find((pl) => pl.id === Number(pid))
              return (
                <div className="stakes-wager-row" key={pid}>
                  <span>{p?.displayName ?? `Player ${pid}`}</span>
                  <strong>{amount} pts</strong>
                </div>
              )
            })}
          </div>
        ) : null}

        <div className="admin-player-list">
          {sessionState.players.map((player) => (
            <div className="admin-player-card" key={player.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <PlayerAvatar avatar={player.avatar} name={player.displayName} />
                <div>
                  <strong>{player.displayName}</strong>
                  <span>
                    {player.playerCode} · {player.isConnected ? t('admin.online') : t('admin.away')} · {player.score ?? 0} pts
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-end' }}>
                <div className="action-row">
                  <span className="chip">{player.preferredLanguage.toUpperCase()}</span>
                  {isBuzzMode && sessionState.phase === 'waiting' ? (
                    <button
                      className={sessionState.boardSelectingPlayerId === player.id ? 'cta-button secondary' : 'ghost-button'}
                      onClick={() => { void handleAssignSelector(player.id) }}
                      style={{ fontSize: '0.82rem', padding: '0.4rem 0.7rem', minHeight: 'auto' }}
                      type="button"
                    >
                      {t('admin.assignSelector')}
                    </button>
                  ) : null}
                  <button
                    className="ghost-button danger-button"
                    onClick={() => { void api.kickPlayer(token!, sessionState.id, player.id, getStoredSessionPin(sessionId) || undefined) }}
                    type="button"
                  >
                    {t('admin.kick')}
                  </button>
                </div>
                {/* Score adjustment */}
                <div className="score-adjust-row">
                  <input
                    className="score-adjust-input"
                    inputMode="numeric"
                    onChange={(e) => setScoreAdjusts((prev) => ({ ...prev, [player.id]: e.target.value }))}
                    placeholder={t('admin.adjustScorePlaceholder')}
                    type="number"
                    value={scoreAdjusts[player.id] ?? ''}
                  />
                  <button
                    className="ghost-button"
                    onClick={() => { void handleAdjustScore(player.id) }}
                    style={{ fontSize: '0.82rem', padding: '0.4rem 0.7rem', minHeight: 'auto' }}
                    type="button"
                  >
                    {t('admin.adjustScoreApply')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Leaderboard ─── */}
      <section className="panel">
        <div className="inline-header">
          <h2>{t('admin.liveLeaderboard')}</h2>
          <span className="chip">{sessionState.mode}</span>
        </div>
        <LeaderboardCard entries={sessionState.leaderboard} />
      </section>

      {/* ─── Review answers ─── */}
      <section className="panel">
        <div className="inline-header">
          <h2>{t('admin.review')}</h2>
          {activeBuzzAnswer ? <span className="chip active">{activeBuzzAnswer.playerName}</span> : null}
        </div>

        <CorrectAnswerPanel
          answer={sessionState.correctAnswer}
          mediaType={sessionState.correctAnswerMediaType}
          mediaUrl={sessionState.correctAnswerMediaUrl}
          title={t('admin.correctAnswer')}
        />

        <div className="review-list">
          {sessionState.answers.map((answer) => (
            <div className="review-box" key={answer.id}>
              <strong>{answer.playerName}</strong>
              <p>{answer.submittedAnswer || '-'}</p>
              <div className="pill-row">
                {answer.suggestedCorrect ? <span className="chip active">{t('admin.autoMatch')}</span> : null}
                {answer.status === 'judged' ? (
                  <span className="chip">{answer.isCorrect ? t('admin.correct') : t('admin.wrong')}</span>
                ) : <span className="chip">{t('admin.pending')}</span>}
                <span className="chip">{answer.awardedPoints} pts</span>
              </div>
              {sessionState.currentQuestion?.type === 'text' && answer.status !== 'judged' && sessionState.mode !== 'buzz' ? (
                <div className="action-row">
                  <button
                    className="cta-button secondary"
                    onClick={() => { void api.judgeAnswer(token!, sessionState.id, answer.id, true, getStoredSessionPin(sessionId) || undefined) }}
                    type="button"
                  >{t('admin.correct')}</button>
                  <button
                    className="ghost-button"
                    onClick={() => { void api.judgeAnswer(token!, sessionState.id, answer.id, false, getStoredSessionPin(sessionId) || undefined) }}
                    type="button"
                  >{t('admin.wrong')}</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {error ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <p className="error-text">{error}</p>
        </div>
      ) : null}
    </div>
  )
}
