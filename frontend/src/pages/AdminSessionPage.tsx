import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LeaderboardCard } from '../components/shared/LeaderboardCard'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../context/I18nContext'
import { useCountdown } from '../hooks/useCountdown'
import { api } from '../services/api'
import { getSocket } from '../services/socket'
import type { AdminSessionState } from '../types'

export function AdminSessionPage() {
  const { t } = useI18n()
  const { sessionId = '' } = useParams()
  const { token, user, loading } = useAuth()
  const [sessionState, setSessionState] = useState<AdminSessionState | null>(null)
  const [answerInput, setAnswerInput] = useState('60')
  const [durationInput, setDurationInput] = useState('15')
  const [error, setError] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const sessionHasStarted = (sessionState?.status === 'live' || (sessionState?.currentQuestionIndex ?? -1) >= 0) ?? false
  const timerEnabled = Boolean(sessionState?.autoAdvanceEnabled)
  const timerPaused = Boolean(sessionState?.autoAdvancePaused)
  const inReview = sessionState?.phase === 'review'
  const timerCounting = timerEnabled && inReview && !timerPaused
  const questionSecondsLeft = useCountdown(sessionState?.phase === 'open' ? sessionState.closesAt : null)
  const autoCountdownLeft = useCountdown(timerCounting ? (sessionState?.autoAdvanceAt ?? null) : null)

  const answerDuration = sessionState?.answerDurationSeconds ?? 60
  const advanceDuration = sessionState?.autoAdvanceDurationSeconds ?? 15
  const answerProgress = sessionState?.phase === 'open' && answerDuration > 0
    ? Math.max(0, Math.min(100, (questionSecondsLeft / answerDuration) * 100))
    : 0
  const advanceCountdown = timerPaused
    ? (sessionState?.autoAdvanceRemainingSeconds ?? 0)
    : autoCountdownLeft
  const advanceProgress = (timerCounting || timerPaused) && inReview && advanceDuration > 0
    ? Math.max(0, Math.min(100, (advanceCountdown / advanceDuration) * 100))
    : 0
  const answerTone = answerProgress > 60 ? 'safe' : answerProgress > 30 ? 'warn' : 'danger'
  const advanceTone = advanceProgress > 60 ? 'safe' : advanceProgress > 30 ? 'warn' : 'danger'

  async function refresh() {
    if (!token) return
    const nextState = await api.getAdminSession(token, sessionId)
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
    if (duration == null) {
      setAnswerInput(String(sessionState.answerDurationSeconds))
      setError('Answer time must be a positive number')
      return
    }
    if (duration === sessionState.answerDurationSeconds) {
      setAnswerInput(String(duration))
      return
    }
    setActionBusy(true)
    try {
      setError('')
      const next = await api.updateAutoAdvance(token, sessionState.id, { answerDurationSeconds: duration })
      setSessionState(next)
      setAnswerInput(String(next.answerDurationSeconds))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update timer')
      setAnswerInput(String(sessionState.answerDurationSeconds))
    } finally {
      setActionBusy(false)
    }
  }

  async function saveDuration(val?: string) {
    if (!token || !sessionState || actionBusy) return
    const duration = parseDuration(val ?? durationInput)
    if (duration == null) {
      setDurationInput(String(sessionState.autoAdvanceDurationSeconds))
      setError('Advance time must be a positive number')
      return
    }
    if (duration === sessionState.autoAdvanceDurationSeconds) {
      setDurationInput(String(duration))
      return
    }
    setActionBusy(true)
    try {
      setError('')
      const next = await api.updateAutoAdvance(token, sessionState.id, { durationSeconds: duration })
      setSessionState(next)
      setDurationInput(String(next.autoAdvanceDurationSeconds))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update timer')
      setDurationInput(String(sessionState.autoAdvanceDurationSeconds))
    } finally {
      setActionBusy(false)
    }
  }

  async function toggleTimer() {
    if (!token || !sessionState || actionBusy) return
    setActionBusy(true)
    try {
      setError('')
      const next = await api.updateAutoAdvance(token, sessionState.id, { enabled: !timerEnabled })
      setSessionState(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update timer')
    } finally {
      setActionBusy(false)
    }
  }

  async function togglePause() {
    if (!token || !sessionState || actionBusy) return
    setActionBusy(true)
    try {
      setError('')
      const next = await api.updateAutoAdvance(token, sessionState.id, { paused: !timerPaused })
      setSessionState(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update timer')
    } finally {
      setActionBusy(false)
    }
  }

  async function triggerHostAction(action: 'advance' | 'close' | 'replay' | 'finish') {
    if (!token || !sessionState || actionBusy) return

    try {
      setActionBusy(true)
      setError('')
      if (action === 'advance') await api.advanceSession(token, sessionState.id)
      if (action === 'close') await api.closeQuestion(token, sessionState.id)
      if (action === 'replay') await api.replayQuestion(token, sessionState.id)
      if (action === 'finish') await api.finishSession(token, sessionState.id)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not update session')
    } finally {
      setActionBusy(false)
    }
  }

  useEffect(() => {
    if (!token) return
    const socket = getSocket()
    const sync = (payload: AdminSessionState) => setSessionState(payload)

    if (!socket.connected) {
      socket.connect()
    }

    refresh().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load session')
    })

    socket.emit(
      'join-admin-session',
      { sessionId: Number(sessionId), token },
      (result: { ok: boolean; message?: string }) => {
        if (!result?.ok) {
          setError(result?.message || 'Could not connect to admin session')
        }
      },
    )

    socket.on('admin:state', sync)

    return () => {
      socket.off('admin:state', sync)
    }
  }, [sessionId, token])

  useEffect(() => {
    if (!sessionState) return
    setAnswerInput(String(sessionState.answerDurationSeconds))
  }, [sessionState?.answerDurationSeconds])

  useEffect(() => {
    if (!sessionState) return
    setDurationInput(String(sessionState.autoAdvanceDurationSeconds))
  }, [sessionState?.autoAdvanceDurationSeconds])

  if (loading) {
    return <section className="panel">{t('common.loading')}</section>
  }

  if (!user || !token) {
    return (
      <section className="panel">
        <Link className="ghost-button" to="/admin">
          {t('admin.loginAction')}
        </Link>
      </section>
    )
  }

  if (!sessionState) {
    return <section className="panel">{error || t('common.loading')}</section>
  }

  const activeBuzzAnswer = sessionState.answers.find(
    (answer) => answer.playerId === sessionState.activeBuzzPlayerId,
  )
  const displayUrl = `${window.location.origin}/display/${sessionState.joinCode}`
  return (
    <div className="admin-session-layout">
      <section className="panel">
        <div className="inline-header">
          <div>
            <span className="eyebrow">{t('admin.sessionControl')}</span>
            <h1>{sessionState.title}</h1>
          </div>
          <div className="action-row">
            <Link className="ghost-button" to="/admin">
              {t('editor.back')}
            </Link>
            <button className="ghost-button" onClick={() => refresh()} type="button">
              {t('admin.refresh')}
            </button>
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
              <span>
                {sessionState.playerCount} / {sessionState.connectedPlayerCount}
              </span>
            </div>
          </div>
          <div className="helper-banner">
            <div>
              <strong>{t('play.questionCounter')}</strong>
              <span>
                {Math.max(sessionState.currentQuestionIndex + 1, 0)} / {sessionState.totalQuestions}
              </span>
            </div>
          </div>
          <div className="helper-banner display-link-banner">
            <div>
              <strong>{t('admin.displayMode')}</strong>
              <span className="display-link-text">{displayUrl}</span>
            </div>
            <div className="action-row">
              <a className="ghost-button" href={displayUrl} rel="noreferrer" target="_blank">
                {t('admin.openDisplay')}
              </a>
              <button
                className="ghost-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(displayUrl)
                  } catch {
                    setError(t('admin.copyFailed'))
                  }
                }}
                type="button"
              >
                {t('admin.copyDisplayLink')}
              </button>
            </div>
          </div>
        </div>

        <div className="admin-control-grid">
          <button className="cta-button" disabled={actionBusy} onClick={() => triggerHostAction('advance')} type="button">
            {sessionHasStarted ? t('admin.openNextQuestion') : t('admin.startSession')}
          </button>
          <button className="ghost-button" disabled={actionBusy} onClick={() => triggerHostAction('close')} type="button">
            {t('admin.closeQuestion')}
          </button>
          <button className="ghost-button" disabled={actionBusy} onClick={() => triggerHostAction('replay')} type="button">
            {t('admin.replayQuestion')}
          </button>
          <button className="ghost-button" disabled={actionBusy} onClick={() => triggerHostAction('finish')} type="button">
            {t('admin.finishSession')}
          </button>
        </div>

        <div className="automation-card">
          <div className="inline-header">
            <div>
              <strong>{t('admin.autoTimer')}</strong>
              <p className="helper-text">{t('admin.autoTimerHint')}</p>
            </div>
            <span className={timerCounting ? 'chip active' : 'chip'}>
              {timerEnabled
                ? timerPaused
                  ? t('admin.paused')
                  : timerCounting
                    ? `${t('admin.nextQuestionIn')} ${autoCountdownLeft}s`
                    : t('admin.running')
                : t('admin.off')}
            </span>
          </div>

          <div className={`session-timer-block${sessionState.phase === 'open' ? ` timer-${answerTone}` : ''}`} style={{ marginBottom: 0 }}>
            <div className="inline-header">
              <strong>{t('admin.answerTimer')}</strong>
              <span>{sessionState.phase === 'open' ? questionSecondsLeft : answerDuration}s</span>
            </div>
            <div className="session-timer-track">
              <div className="session-timer-fill" style={{ width: `${answerProgress}%` }} />
            </div>
            <label style={{ display: 'grid', gap: '0.4rem', color: 'var(--muted)' }}>
              <span>{t('editor.timer')}</span>
              <input
                inputMode="numeric"
                min={1}
                onBlur={() => { void saveAnswerDuration() }}
                onChange={(e) => setAnswerInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  void saveAnswerDuration((e.target as HTMLInputElement).value)
                }}
                type="number"
                value={answerInput}
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
                  inputMode="numeric"
                  min={1}
                  onBlur={() => { void saveDuration() }}
                  onChange={(e) => setDurationInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    void saveDuration((e.target as HTMLInputElement).value)
                  }}
                  type="number"
                  value={durationInput}
                />
              </label>
              <button
                className="cta-button secondary"
                disabled={actionBusy}
                onClick={() => { void toggleTimer() }}
                type="button"
              >
                {timerEnabled ? t('admin.stopAutoTimer') : t('admin.startAutoTimer')}
              </button>
              <button
                className="ghost-button"
                disabled={!timerEnabled || !sessionHasStarted || actionBusy}
                onClick={() => { void togglePause() }}
                type="button"
              >
                {timerPaused ? t('admin.resume') : t('admin.pause')}
              </button>
            </div>
          </div>
        </div>

        {sessionState.currentQuestion ? (
          <div className="question-card">
            <span className="eyebrow">{sessionState.mode.toUpperCase()}</span>
            <h2>{sessionState.currentQuestion.prompt}</h2>
            <p className="helper-text">{sessionState.currentQuestion.helpText}</p>
            <div className="pill-row">
              <span className="chip">{sessionState.phase}</span>
              <span className="chip">{sessionState.answerCount} answers</span>
            </div>
          </div>
        ) : (
          <div className="question-card waiting-card">
            <h2>{t('admin.noSessionSelected')}</h2>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="inline-header">
          <h2>{t('admin.players')}</h2>
          <span className="chip active">{sessionState.joinCode}</span>
        </div>
        <div className="admin-player-list">
          {sessionState.players.map((player) => (
            <div className="admin-player-card" key={player.id}>
              <div>
                <strong>{player.displayName}</strong>
                <span>
                  {player.playerCode} - {player.isConnected ? t('admin.online') : t('admin.away')}
                </span>
              </div>
              <div className="action-row">
                <span className="chip">{player.preferredLanguage.toUpperCase()}</span>
                <button
                  className="ghost-button"
                  onClick={() => api.kickPlayer(token, sessionState.id, player.id)}
                  type="button"
                >
                  {t('admin.kick')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="inline-header">
          <h2>{t('admin.liveLeaderboard')}</h2>
          <span className="chip">{sessionState.mode}</span>
        </div>
        <LeaderboardCard entries={sessionState.leaderboard} />
      </section>

      <section className="panel">
        <div className="inline-header">
          <h2>{t('admin.review')}</h2>
          {activeBuzzAnswer ? <span className="chip active">{activeBuzzAnswer.playerName}</span> : null}
        </div>

        {sessionState.mode === 'buzz' && activeBuzzAnswer ? (
          <div className="review-box">
            <strong>{activeBuzzAnswer.playerName}</strong>
            <p>{activeBuzzAnswer.submittedAnswer || t('admin.awaitingAttempt')}</p>
            <div className="action-row">
              <button
                className="cta-button secondary"
                onClick={() => api.judgeBuzz(token, sessionState.id, true)}
                type="button"
              >
                {t('admin.correct')}
              </button>
              <button
                className="ghost-button"
                onClick={() => api.judgeBuzz(token, sessionState.id, false)}
                type="button"
              >
                {t('admin.wrong')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="review-list">
          {sessionState.answers.map((answer) => (
            <div className="review-box" key={answer.id}>
              <strong>{answer.playerName}</strong>
              <p>{answer.submittedAnswer || '-'}</p>
              <div className="pill-row">
                {answer.suggestedCorrect ? <span className="chip active">{t('admin.autoMatch')}</span> : null}
                {answer.status === 'judged' ? (
                  <span className="chip">{answer.isCorrect ? t('admin.correct') : t('admin.wrong')}</span>
                ) : (
                  <span className="chip">{t('admin.pending')}</span>
                )}
              </div>
              {sessionState.currentQuestion?.type === 'text' && answer.status !== 'judged' ? (
                <div className="action-row">
                  <button
                    className="cta-button secondary"
                    onClick={() => api.judgeAnswer(token, sessionState.id, answer.id, true)}
                    type="button"
                  >
                    {t('admin.correct')}
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => api.judgeAnswer(token, sessionState.id, answer.id, false)}
                    type="button"
                  >
                    {t('admin.wrong')}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
