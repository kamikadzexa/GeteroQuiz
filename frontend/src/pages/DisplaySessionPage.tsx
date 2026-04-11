import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BuzzBoard } from '../components/shared/BuzzBoard'
import { LeaderboardCard } from '../components/shared/LeaderboardCard'
import { QuestionMedia } from '../components/shared/QuestionMedia'
import { useI18n } from '../context/I18nContext'
import { useCountdown } from '../hooks/useCountdown'
import { api } from '../services/api'
import { getSocket } from '../services/socket'
import type { SessionState } from '../types'

export function DisplaySessionPage() {
  const { joinCode = '' } = useParams()
  const { t } = useI18n()
  const [session, setSession] = useState<SessionState | null>(null)
  const [localAutoplayOverride, setLocalAutoplayOverride] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [splashQueue, setSplashQueue] = useState<Array<{ title: string; subtitle?: string; tone?: 'round' | 'special' }>>([])
  const [activeSplash, setActiveSplash] = useState<{ title: string; subtitle?: string; tone?: 'round' | 'special' } | null>(null)
  const previousQuestionRef = useRef<{ id: number | null; roundName: string | null }>({ id: null, roundName: null })
  const announcedRoundRef = useRef<string | null>(null)
  const questionSecondsLeft = useCountdown(
    session?.phase === 'open' ? session.closesAt : null,
    session?.serverNow ?? null,
  )
  const autoAdvanceSecondsLeft = useCountdown(session?.autoAdvanceAt ?? null, session?.serverNow ?? null)

  const activeTimer =
    session &&
    session.currentQuestion &&
    session.phase === 'open' &&
    (session.answerDurationSeconds ?? session.currentQuestion.timeLimitSeconds) > 0 &&
    (session.closesAt || session.autoAdvancePaused)
      ? {
          label: t('play.answerTimer'),
          totalSeconds: session.answerDurationSeconds ?? session.currentQuestion.timeLimitSeconds,
          remainingSeconds: session.closesAt ? questionSecondsLeft : session.questionRemainingSeconds,
          paused: session.autoAdvancePaused,
        }
      : session && session.autoAdvanceEnabled && session.status !== 'finished' && session.phase !== 'open'
        ? {
            label: session.autoAdvancePaused ? t('admin.paused') : t('play.nextStepTimer'),
            totalSeconds: session.autoAdvanceDurationSeconds,
            remainingSeconds: session.autoAdvanceAt ? autoAdvanceSecondsLeft : session.autoAdvanceRemainingSeconds,
            paused: session.autoAdvancePaused,
          }
        : null

  const timerProgress = activeTimer
    ? Math.max(0, Math.min(100, (activeTimer.remainingSeconds / Math.max(activeTimer.totalSeconds, 1)) * 100))
    : 0
  const timerTone = timerProgress > 60 ? 'safe' : timerProgress > 30 ? 'warn' : 'danger'

  const questionOptions = useMemo(() => {
    if (!session?.currentQuestion || session.currentQuestion.type !== 'multiple_choice') return []
    return session.currentQuestion.options
  }, [session])
  const isBuzzWaiting = session?.mode === 'buzz' && session.status === 'live' && session.phase === 'waiting'
  const shouldShowQuestionMedia = Boolean(
    session?.currentQuestion && !(
      session.phase === 'review' &&
      session.currentQuestion.correctAnswerMediaType &&
      session.currentQuestion.correctAnswerMediaType !== 'none' &&
      session.currentQuestion.correctAnswerMediaUrl
    ),
  )
  const boardSelectorName = session?.boardSelectingPlayerId != null
    ? session.leaderboard.find((entry) => entry.playerId === session.boardSelectingPlayerId)?.displayName
    : undefined

  // Effective autoplay: local override takes precedence, falls back to server setting
  const effectiveAutoplay = localAutoplayOverride !== null ? localAutoplayOverride : (session?.mediaAutoplayEnabled ?? true)

  const pushSplashes = useMemo(
    () => (items: Array<{ title: string; subtitle?: string; tone?: 'round' | 'special' }>) => {
      if (items.length === 0) return

      setActiveSplash((currentActive) => {
        if (currentActive) {
          setSplashQueue((currentQueue) => [...currentQueue, ...items])
          return currentActive
        }

        const [firstItem, ...rest] = items
        if (rest.length > 0) {
          setSplashQueue((currentQueue) => [...currentQueue, ...rest])
        }
        return firstItem
      })
    },
    [],
  )

  useEffect(() => {
    if (activeSplash) {
      const timer = window.setTimeout(() => setActiveSplash(null), 2200)
      return () => window.clearTimeout(timer)
    }

    if (splashQueue.length === 0) return

    const [nextSplash, ...remaining] = splashQueue
    setActiveSplash(nextSplash)
    setSplashQueue(remaining)
  }, [activeSplash, splashQueue])

  useEffect(() => {
    if (!session || session.mode !== 'buzz' || session.phase !== 'waiting' || session.status !== 'live') return
    if (!session.upcomingRoundName || announcedRoundRef.current === session.upcomingRoundName) return

    announcedRoundRef.current = session.upcomingRoundName
    pushSplashes([{
      title: session.upcomingRoundName,
      subtitle: t('play.roundStart'),
      tone: 'round',
    }])
  }, [pushSplashes, session, t])

  useEffect(() => {
    if (!session || session.mode !== 'buzz' || session.phase !== 'open' || !session.currentQuestion) return

    const previous = previousQuestionRef.current
    const currentQuestion = session.currentQuestion

    if (previous.id === currentQuestion.id) return

    const nextQueue: Array<{ title: string; subtitle?: string; tone?: 'round' | 'special' }> = []

    if (currentQuestion.roundName && currentQuestion.roundName !== previous.roundName) {
      announcedRoundRef.current = currentQuestion.roundName
      nextQueue.push({
        title: currentQuestion.roundName,
        subtitle: t('play.roundStart'),
        tone: 'round',
      })
    }

    if (currentQuestion.specialType === 'cat_in_bag') {
      nextQueue.push({ title: t('play.catInBagTitle'), subtitle: t('play.specialReveal'), tone: 'special' })
    } else if (currentQuestion.specialType === 'stakes') {
      nextQueue.push({ title: t('play.stakesTitle'), subtitle: t('play.specialReveal'), tone: 'special' })
    }

    pushSplashes(nextQueue)

    previousQuestionRef.current = {
      id: currentQuestion.id,
      roundName: currentQuestion.roundName || null,
    }
  }, [pushSplashes, session, t])

  useEffect(() => {
    let active = true
    const socket = getSocket()

    if (!socket.connected) {
      socket.connect()
    }

    api.getPublicSession(joinCode).then((nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (nextSession?.id) {
        socket.emit('join-display-session', { sessionId: nextSession.id }, () => {})
      }
    }).catch((loadError: unknown) => {
      if (!active) return
      setError(loadError instanceof Error ? loadError.message : 'Could not load display')
    })

    const syncState = (payload: SessionState) => {
      if (!active) return
      setSession(payload)
    }

    const syncLeaderboard = (leaderboard: SessionState['leaderboard']) => {
      if (!active) return
      setSession((prev) => prev ? { ...prev, leaderboard } : prev)
    }

    socket.on('session:state', syncState)
    socket.on('leaderboard:update', syncLeaderboard)

    return () => {
      active = false
      socket.off('session:state', syncState)
      socket.off('leaderboard:update', syncLeaderboard)
    }
  }, [joinCode])

  return (
    <div className="display-layout">
      <section className="panel display-main-panel">
        {activeSplash ? (
          <div className={`board-splash-overlay ${activeSplash.tone === 'special' ? 'special' : 'round'}`}>
            <div className="board-splash-card">
              {activeSplash.subtitle ? <span className="eyebrow">{activeSplash.subtitle}</span> : null}
              <h2>{activeSplash.title}</h2>
            </div>
          </div>
        ) : null}

        <div className="inline-header">
          <div>
            <span className="eyebrow">{t('display.badge')}</span>
            <h1>{session?.title || t('common.loading')}</h1>
          </div>
          <div className="pill-row">
            <span className="chip">{joinCode}</span>
          </div>
        </div>

        {activeTimer ? (
          <div className={`session-timer-block timer-${timerTone} ${activeTimer.paused ? 'paused' : ''}`}>
            <div className="inline-header">
              <strong>{activeTimer.label}</strong>
              <span>{Math.max(activeTimer.remainingSeconds, 0)}s</span>
            </div>
            <div className="session-timer-track">
              <div className="session-timer-fill" style={{ width: `${timerProgress}%` }} />
            </div>
          </div>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}

        {!session ? (
          <p>{t('common.loading')}</p>
        ) : session.status === 'finished' ? (
          <div className="question-card reveal-card reveal-neutral">
            <span className="eyebrow">{t('play.finished')}</span>
            <h2>{t('play.finalHeading')}</h2>
            <LeaderboardCard entries={session.leaderboard} />
          </div>
        ) : isBuzzWaiting ? (
          <div className="question-card display-question-card">
            <span className="eyebrow">{t('play.boardTitle')}</span>
            {session.upcomingRoundName ? <span className="round-label">{session.upcomingRoundName}</span> : null}
            <h2>{t('play.boardTitle')}</h2>
            <p className="helper-text">{t('play.waitingCopy')}</p>
            <BuzzBoard
              answeredIds={session.boardAnsweredQuestionIds}
              columns={session.boardColumns}
              emptyHint={t('play.boardNoSelector')}
              isWaiting
              selectingHint={boardSelectorName ? `${boardSelectorName} ${t('play.boardOtherTurn')}` : undefined}
              selectingPlayerId={session.boardSelectingPlayerId}
              selectorName={boardSelectorName}
              viewerPlayerId={null}
              viewerScore={0}
            />
          </div>
        ) : session.currentQuestion ? (
          <div className="question-card display-question-card">
            <span className="eyebrow">{session.mode.toUpperCase()}</span>
            {session.currentQuestion.roundName ? <span className="round-label">{session.currentQuestion.roundName}</span> : null}
            <h2>{session.currentQuestion.prompt}</h2>
            {session.currentQuestion.helpText ? <p className="helper-text">{session.currentQuestion.helpText}</p> : null}
            {shouldShowQuestionMedia ? <QuestionMedia autoplay={effectiveAutoplay} question={session.currentQuestion} /> : null}

            {questionOptions.length > 0 ? (
              <div className="display-options-grid">
                {questionOptions.map((option) => {
                  const isCorrect =
                    session.phase === 'review' && session.currentQuestion?.correctAnswer === option.id
                  return (
                    <div
                      className={isCorrect ? 'option-button result-correct' : 'option-button'}
                      key={option.id}
                    >
                      <span>{option.id}</span>
                      <strong>{option.text}</strong>
                    </div>
                  )
                })}
              </div>
            ) : session.currentQuestion.type === 'text' && session.phase === 'review' ? (
              <div className="answer-reveal-panel">
                <div>
                  <strong>{t('play.correctText')}</strong>
                  <p className="correct-answer-text">{session.currentQuestion.correctAnswer || '-'}</p>
                </div>
                {session.currentQuestion.correctAnswerMediaType && session.currentQuestion.correctAnswerMediaType !== 'none' && session.currentQuestion.correctAnswerMediaUrl ? (
                  <div className="media-block answer-reveal-media">
                    {session.currentQuestion.correctAnswerMediaType === 'image' ? (
                      <img alt="Correct answer" className="media-visual" src={session.currentQuestion.correctAnswerMediaUrl} style={{ width: '100%', objectFit: 'contain' }} />
                    ) : session.currentQuestion.correctAnswerMediaType === 'video' ? (
                      <video className="media-visual" controls src={session.currentQuestion.correctAnswerMediaUrl} style={{ width: '100%' }} />
                    ) : (
                      <audio controls src={session.currentQuestion.correctAnswerMediaUrl} style={{ width: '100%' }} />
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="question-card waiting-card">
            <span className="eyebrow">{t('play.waiting')}</span>
            <h2>{t('play.waitingTitle')}</h2>
            <p>{t('play.waitingCopy')}</p>
          </div>
        )}
      </section>

      <aside className="sidebar-stack">
        <section className="panel compact-panel">
          <span className="eyebrow">{t('play.liveBoard')}</span>
          <LeaderboardCard entries={session?.leaderboard || []} />
        </section>
        <section className="panel compact-panel">
          <span className="eyebrow">{t('display.openOnTv')}</span>
          <p className="helper-text">{t('display.tvHint')}</p>
          <div className="action-row">
            <Link className="ghost-button" to={`/leaderboard/${joinCode}`}>
              {t('play.openLeaderboard')}
            </Link>
          </div>
        </section>
        <section className="panel compact-panel">
          <span className="eyebrow">{t('admin.mediaAutoplay')}</span>
          <div className="action-row">
            <span className={effectiveAutoplay ? 'chip active' : 'chip'}>
              {effectiveAutoplay ? t('admin.mediaAutoplayOn') : t('admin.mediaAutoplayOff')}
            </span>
            <button
              className={effectiveAutoplay ? 'cta-button secondary' : 'ghost-button'}
              onClick={() => setLocalAutoplayOverride(!effectiveAutoplay)}
              type="button"
            >
              {effectiveAutoplay ? t('admin.disableMediaAutoplay') : t('admin.enableMediaAutoplay')}
            </button>
          </div>
        </section>
      </aside>
    </div>
  )
}
