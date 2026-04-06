import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  const [error, setError] = useState('')
  const questionSecondsLeft = useCountdown(session?.phase === 'open' ? session.closesAt : null)
  const autoAdvanceSecondsLeft = useCountdown(session?.autoAdvanceAt ?? null)

  const activeTimer =
    session && session.currentQuestion && session.phase === 'open' && (session.answerDurationSeconds ?? session.currentQuestion.timeLimitSeconds) > 0
      ? {
          label: t('play.answerTimer'),
          totalSeconds: session.answerDurationSeconds ?? session.currentQuestion.timeLimitSeconds,
          remainingSeconds: questionSecondsLeft,
          paused: false,
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

  useEffect(() => {
    let active = true
    const socket = getSocket()

    async function refresh() {
      const next = await api.getPublicSession(joinCode)
      if (!active) return
      setSession(next)
      return next
    }

    const sync = () => {
      refresh().catch((loadError) => {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Could not load display')
      })
    }

    if (!socket.connected) {
      socket.connect()
    }

    refresh().then((nextSession) => {
      if (nextSession?.id) {
        socket.emit('join-display-session', { sessionId: nextSession.id }, () => {})
      }
    }).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load display')
    })

    socket.on('session:state', sync)
    socket.on('leaderboard:update', sync)

    return () => {
      active = false
      socket.off('session:state', sync)
      socket.off('leaderboard:update', sync)
    }
  }, [joinCode])

  return (
    <div className="display-layout">
      <section className="panel display-main-panel">
        <div className="inline-header">
          <div>
            <span className="eyebrow">{t('display.badge')}</span>
            <h1>{session?.title || t('common.loading')}</h1>
          </div>
          <div className="pill-row">
            <span className="chip active">{joinCode}</span>
            {activeTimer ? <span className="timer-pill">{Math.max(activeTimer.remainingSeconds, 0)}s</span> : null}
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
        ) : session.currentQuestion ? (
          <div className="question-card display-question-card">
            <span className="eyebrow">{session.mode.toUpperCase()}</span>
            <h2>{session.currentQuestion.prompt}</h2>
            {session.currentQuestion.helpText ? <p className="helper-text">{session.currentQuestion.helpText}</p> : null}
            <QuestionMedia question={session.currentQuestion} />

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
              <div className="text-review-card">
                <div>
                  <strong>{t('play.correctText')}</strong>
                  <p>{session.currentQuestion.correctAnswer || '-'}</p>
                </div>
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
      </aside>
    </div>
  )
}
