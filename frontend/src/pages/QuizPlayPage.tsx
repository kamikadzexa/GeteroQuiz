import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BuzzBoard } from '../components/shared/BuzzBoard'
import { LeaderboardCard } from '../components/shared/LeaderboardCard'
import { QuestionMedia } from '../components/shared/QuestionMedia'
import { useI18n } from '../context/I18nContext'
import { usePlayerSessions } from '../context/PlayerSessionContext'
import { useCountdown } from '../hooks/useCountdown'
import { api } from '../services/api'
import { getSocket } from '../services/socket'
import type { QuestionOption, SessionState } from '../types'

export function QuizPlayPage() {
  const { joinCode = '' } = useParams()
  const { t } = useI18n()
  const navigate = useNavigate()
  const { getSession, removeSession } = usePlayerSessions()
  const player = getSession(joinCode)

  const [session, setSession] = useState<SessionState | null>(null)
  const [answerValue, setAnswerValue] = useState('')
  const [buzzTextValue, setBuzzTextValue] = useState('')
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [wagerInput, setWagerInput] = useState('')
  const [wagerSubmitted, setWagerSubmitted] = useState(false)

  const buzzTextRef = useRef('')

  const questionSecondsLeft = useCountdown(
    session?.phase === 'open' ? session.closesAt : null,
    session?.serverNow ?? null,
  )
  const autoAdvanceSecondsLeft = useCountdown(session?.autoAdvanceAt ?? null, session?.serverNow ?? null)

  const emitSocket = useCallback((event: string, payload: Record<string, unknown>) => {
    const socket = getSocket()
    return new Promise<void>((resolve, reject) => {
      socket.emit(event, payload, (result: { ok: boolean; message?: string }) => {
        if (result?.ok) {
          resolve()
          return
        }
        reject(new Error(result?.message || 'Action failed'))
      })
    })
  }, [])

  async function refresh() {
    if (!player) return
    const next = await api.getPublicSession(joinCode, player.playerId)
    setSession(next)

    if (next.viewerAnswer?.submittedAnswer && next.currentQuestion?.type === 'text') {
      setAnswerValue(next.viewerAnswer.submittedAnswer)
    }

    if (next.lockedBuzzPlayer?.playerId === player.playerId && next.viewerAnswer?.submittedAnswer) {
      setBuzzTextValue(next.viewerAnswer.submittedAnswer)
    }

    if (!next.stakesPhase) {
      setWagerSubmitted(false)
      setWagerInput('')
    }
  }

  function sendBuzzTextUpdate(text: string) {
    if (!player || !session) return
    const socket = getSocket()
    socket.emit('player:buzz-text-update', {
      sessionId: player.sessionId,
      playerId: player.playerId,
      text,
    })
  }

  useEffect(() => {
    if (!player) {
      navigate(`/?code=${joinCode}`)
      return
    }

    let active = true
    const socket = getSocket()

    const sync = () => {
      if (!active) return
      refresh().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load session')
      })
    }

    if (!socket.connected) socket.connect()

    socket.emit(
      'join-player-session',
      { sessionId: player.sessionId, playerId: player.playerId },
      (result: { ok: boolean; message?: string }) => {
        if (!result?.ok) {
          setError(result?.message || 'Could not connect to the live session')
          return
        }
        sync()
      },
    )

    socket.on('session:state', sync)
    socket.on('leaderboard:update', sync)
    socket.on('player:kicked', () => {
      removeSession(joinCode)
      navigate(`/?code=${joinCode}`)
    })

    return () => {
      active = false
      socket.off('session:state', sync)
      socket.off('leaderboard:update', sync)
      socket.off('player:kicked')
    }
  }, [joinCode, navigate, player, removeSession])

  useEffect(() => {
    if (session?.currentQuestion?.type !== 'multiple_choice') {
      setSelectedOptionId(null)
      return
    }
    setSelectedOptionId(session.viewerAnswer?.submittedAnswer ?? null)
  }, [session?.currentQuestion?.id, session?.currentQuestion?.type, session?.viewerAnswer?.submittedAnswer])

  useEffect(() => {
    if (session?.lockedBuzzPlayer?.playerId !== player?.playerId) {
      setBuzzTextValue('')
      buzzTextRef.current = ''
    }
  }, [session?.lockedBuzzPlayer?.playerId, player?.playerId])

  useEffect(() => {
    if (!session?.stakesPhase) {
      setWagerSubmitted(false)
      setWagerInput('')
    }
  }, [session?.stakesPhase])

  if (!player) return null

  const currentQuestion = session?.currentQuestion ?? null
  const viewerAnswer = session?.viewerAnswer ?? null
  const isBuzzMode = session?.mode === 'buzz'
  const anotherPlayerBuzzed = session?.lockedBuzzPlayer && session.lockedBuzzPlayer.playerId !== player.playerId
  const currentPlayerBuzzed = session?.lockedBuzzPlayer?.playerId === player.playerId
  const canBuzz =
    session?.phase === 'open' &&
    isBuzzMode &&
    !session.lockedBuzzPlayer &&
    !session.deniedBuzzPlayerIds.includes(player.playerId) &&
    session.catInBagPhase == null &&
    session.stakesPhase !== 'collecting' &&
    !(session.stakesPhase === 'answering' && session.stakesSelectedPlayerId !== player.playerId) &&
    !(session.catInBagTargetPlayerId != null && session.catInBagTargetPlayerId !== player.playerId)

  const isStakesAnswerer = session?.stakesPhase === 'answering' && session.stakesSelectedPlayerId === player.playerId
  const isCibTarget = session?.catInBagTargetPlayerId === player.playerId && session.catInBagPhase == null
  const isBoardSelector = session?.boardSelectingPlayerId === player.playerId

  const revealTone =
    session?.phase === 'review'
      ? viewerAnswer?.isCorrect === true
        ? 'question-card reveal-card reveal-correct'
        : viewerAnswer?.isCorrect === false
          ? 'question-card reveal-card reveal-wrong'
          : 'question-card reveal-card reveal-neutral'
      : 'question-card'

  const activeTimer =
    session && currentQuestion && session.phase === 'open' &&
    (session.answerDurationSeconds ?? currentQuestion.timeLimitSeconds) > 0 &&
    (session.closesAt || session.autoAdvancePaused)
      ? {
          label: t('play.answerTimer'),
          totalSeconds: session.answerDurationSeconds ?? currentQuestion.timeLimitSeconds,
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
  const selectedAnswerId = viewerAnswer?.submittedAnswer ?? selectedOptionId
  const selectedOption = currentQuestion?.type === 'multiple_choice'
    ? currentQuestion.options.find((option) => option.id === selectedAnswerId) ?? null
    : null
  const showBuzzBoard = isBuzzMode && session?.status === 'live' && session.phase === 'waiting'

  const getOptionClassName = (option: QuestionOption) => {
    if (!session) return 'option-button'
    const selected = selectedAnswerId === option.id
    const correct = session.phase === 'review' && currentQuestion?.correctAnswer === option.id

    if (session.phase === 'review') {
      if (correct) return selected ? 'option-button result-correct result-selected' : 'option-button result-correct'
      if (selected) return 'option-button result-wrong result-selected'
      return 'option-button result-muted'
    }

    if (selected) return 'option-button active option-button-submitted'
    return 'option-button'
  }

  return (
    <div className="play-layout">
      <section className="panel game-panel">
        <div className="status-strip">
          <div>
            <span className="eyebrow">{session?.title || t('common.loading')}</span>
            <strong>
              {t('play.questionCounter')} {Math.max((session?.currentQuestionIndex ?? -1) + 1, 0)}/
              {session?.totalQuestions ?? 0}
            </strong>
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
            <LeaderboardCard compact entries={session.leaderboard} />
            <div className="action-row">
              <Link className="ghost-button" to={`/leaderboard/${joinCode}`}>{t('play.openLeaderboard')}</Link>
            </div>
          </div>
        ) : showBuzzBoard ? (
          <div className="question-card" style={{ minHeight: '20rem' }}>
            <span className="eyebrow">{isBoardSelector ? t('play.boardYourTurn') : t('play.boardTitle')}</span>
            <BuzzBoard
              answeredIds={session.boardAnsweredQuestionIds}
              columns={session.boardColumns}
              isWaiting={true}
              onSelectTile={async (questionId) => {
                setBusy(true)
                setError('')
                try {
                  await emitSocket('player:select-question', {
                    sessionId: player.sessionId,
                    playerId: player.playerId,
                    questionId,
                  })
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not select question')
                } finally {
                  setBusy(false)
                }
              }}
              selectorName={session.boardSelectingPlayerId != null
                ? session.leaderboard.find((entry) => entry.playerId === session.boardSelectingPlayerId)?.displayName
                : undefined}
              selectingPlayerId={session.boardSelectingPlayerId}
              viewerPlayerId={player.playerId}
              viewerScore={session.viewerScore ?? 0}
            />
          </div>
        ) : currentQuestion ? (
          <div className={revealTone}>
            <span className="eyebrow">
              {session.mode.toUpperCase()}
              {currentQuestion.specialType && currentQuestion.specialType !== 'normal'
                ? ` · ${currentQuestion.specialType === 'cat_in_bag' ? 'CAT IN THE BAG' : 'STAKES'}`
                : ''}
              {currentQuestion.columnName ? ` - ${currentQuestion.columnName}` : ''}
            </span>
            <h2>{currentQuestion.prompt}</h2>
            {currentQuestion.helpText ? <p className="helper-text">{currentQuestion.helpText}</p> : null}
            <QuestionMedia question={currentQuestion} />

            {isBuzzMode && session.catInBagPhase === 'selecting' ? (
              <div className="special-phase-panel">
                <span className="eyebrow">{t('play.catInBagTitle')}</span>
                {isBoardSelector ? (
                  <div>
                    <p className="helper-text">{t('play.catInBagPrompt')}</p>
                    <div className="cib-player-grid">
                      {session.leaderboard
                        .filter((entry) => entry.playerId !== player.playerId)
                        .map((entry) => (
                          <button
                            className="ghost-button cib-player-btn"
                            disabled={busy}
                            key={entry.playerId}
                            onClick={async () => {
                              setBusy(true)
                              setError('')
                              try {
                                await emitSocket('player:cib-assign', {
                                  sessionId: player.sessionId,
                                  assigningPlayerId: player.playerId,
                                  targetPlayerId: entry.playerId,
                                })
                              } catch (e) {
                                setError(e instanceof Error ? e.message : 'Could not assign')
                              } finally {
                                setBusy(false)
                              }
                            }}
                            type="button"
                          >
                            {entry.displayName}
                          </button>
                        ))}
                    </div>
                  </div>
                ) : (
                  <p className="helper-text">{t('play.catInBagWaiting')}</p>
                )}
              </div>
            ) : null}

            {isBuzzMode && session.catInBagPhase == null && session.catInBagTargetPlayerId != null && isCibTarget && session.phase === 'open' ? (
              <div className="special-phase-panel">
                <span className="eyebrow">{t('play.catInBagAssigned')}</span>
              </div>
            ) : null}

            {isBuzzMode && session.stakesPhase === 'collecting' ? (
              <div className="special-phase-panel">
                <span className="eyebrow">{t('play.stakesTitle')}</span>
                {!wagerSubmitted ? (
                  <div style={{ display: 'grid', gap: '0.6rem' }}>
                    <p className="helper-text">{t('play.stakesYourScore')} {session.viewerScore ?? 0} pts</p>
                    <input
                      inputMode="numeric"
                      max={session.viewerScore ?? 0}
                      min={0}
                      onChange={(event) => setWagerInput(event.target.value)}
                      placeholder={t('play.stakesPrompt')}
                      type="number"
                      value={wagerInput}
                    />
                    <button
                      className="cta-button"
                      disabled={busy || !wagerInput.trim()}
                      onClick={async () => {
                        setBusy(true)
                        setError('')
                        try {
                          await emitSocket('player:stakes-wager', {
                            sessionId: player.sessionId,
                            playerId: player.playerId,
                            wager: Number(wagerInput),
                          })
                          setWagerSubmitted(true)
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Could not submit wager')
                        } finally {
                          setBusy(false)
                        }
                      }}
                      type="button"
                    >
                      {t('play.stakesSubmitWager')}
                    </button>
                  </div>
                ) : (
                  <p className="helper-text">{t('play.stakesWagerSubmitted')} · {t('play.stakesWaiting')}</p>
                )}
              </div>
            ) : null}

            {isBuzzMode && session.stakesPhase === 'answering' ? (
              <div className="special-phase-panel">
                <span className="eyebrow">{t('play.stakesTitle')}</span>
                {isStakesAnswerer ? (
                  <p className="helper-text">{t('play.stakesYouAnswer')}</p>
                ) : (
                  <p className="helper-text">{session.stakesSelectedName} {t('play.stakesOtherAnswers')}</p>
                )}
              </div>
            ) : null}

            {currentQuestion.type === 'multiple_choice' && session.mode === 'classic' ? (
              <div className="answer-zone">
                <div className="option-grid">
                  {currentQuestion.options.map((option) => (
                    <button
                      key={option.id}
                      className={getOptionClassName(option)}
                      disabled={busy || session.phase === 'review'}
                      onClick={async () => {
                        if (session.phase !== 'open') return
                        setBusy(true)
                        setError('')
                        setSelectedOptionId(option.id)
                        try {
                          await emitSocket('player:submit-answer', {
                            sessionId: player.sessionId,
                            playerId: player.playerId,
                            value: option.id,
                          })
                          await refresh()
                        } catch (submitError) {
                          setError(submitError instanceof Error ? submitError.message : 'Could not submit answer')
                        } finally {
                          setBusy(false)
                        }
                      }}
                      type="button"
                    >
                      <span>{option.id}</span>
                      <strong>{option.text}</strong>
                    </button>
                  ))}
                </div>
                {session.phase !== 'review' ? (
                  <p className="helper-text">{t('play.answersCount')} {session.answerCount}</p>
                ) : null}
                {selectedOption ? (
                  <div className="answer-summary-card">
                    <strong>{t('play.yourAnswer')}</strong>
                    <p>{selectedOption.id}. {selectedOption.text}</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {currentQuestion.type === 'text' && session.mode === 'classic' ? (
              session.phase === 'review' ? (
                <div className={
                  viewerAnswer?.isCorrect === true ? 'text-review-card text-review-card-correct'
                    : viewerAnswer?.isCorrect === false ? 'text-review-card text-review-card-wrong'
                      : 'text-review-card'
                }>
                  <div>
                    <strong>{t('play.yourAnswer')}</strong>
                    <p>{viewerAnswer?.submittedAnswer || '-'}</p>
                  </div>
                  <div>
                    <strong>{t('play.correctText')}</strong>
                    <p>{currentQuestion.correctAnswer || '-'}</p>
                  </div>
                </div>
              ) : (
                <div className={viewerAnswer?.submittedAnswer ? 'text-answer-box submitted-box' : 'text-answer-box'}>
                  <textarea
                    onChange={(event) => setAnswerValue(event.target.value)}
                    placeholder={t('play.textPlaceholder')}
                    rows={4}
                    value={answerValue}
                  />
                  <button
                    className="cta-button submit-pop"
                    disabled={busy || !answerValue.trim()}
                    onClick={async () => {
                      setBusy(true)
                      setError('')
                      try {
                        await emitSocket('player:submit-answer', {
                          sessionId: player.sessionId,
                          playerId: player.playerId,
                          value: answerValue,
                        })
                        await refresh()
                      } catch (submitError) {
                        setError(submitError instanceof Error ? submitError.message : 'Could not submit answer')
                      } finally {
                        setBusy(false)
                      }
                    }}
                    type="button"
                  >
                    {t('play.submit')}
                  </button>
                </div>
              )
            ) : null}

            {session.phase === 'open' && isBuzzMode && session.catInBagPhase == null && session.stakesPhase !== 'collecting' ? (
              <div className="buzz-panel">
                {canBuzz ? (
                  <button
                    className="buzz-button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      setError('')
                      try {
                        await emitSocket('player:buzz', { sessionId: player.sessionId, playerId: player.playerId })
                        await refresh()
                      } catch (buzzError) {
                        setError(buzzError instanceof Error ? buzzError.message : 'Could not buzz in')
                      } finally {
                        setBusy(false)
                      }
                    }}
                    type="button"
                  >
                    {t('play.buzz')}
                  </button>
                ) : null}

                {anotherPlayerBuzzed ? (
                  <p className="helper-text">{session.lockedBuzzPlayer?.displayName} {t('play.buzzedFirst')}</p>
                ) : null}

                {currentPlayerBuzzed ? (
                  <div className={buzzTextValue ? 'text-answer-box submitted-box' : 'text-answer-box'}>
                    <p className="helper-text" style={{ margin: 0 }}>
                      {t('play.typeYourAnswer')} - {t('play.buzzPlaceholder')}
                    </p>
                    <textarea
                      onChange={(event) => {
                        const text = event.target.value
                        setBuzzTextValue(text)
                        buzzTextRef.current = text
                        sendBuzzTextUpdate(text)
                      }}
                      placeholder={t('play.buzzPlaceholder')}
                      rows={3}
                      value={buzzTextValue}
                    />
                    <button
                      className="cta-button submit-pop"
                      disabled={busy || !buzzTextValue.trim()}
                      onClick={async () => {
                        setBusy(true)
                        setError('')
                        try {
                          await emitSocket('player:buzz-answer', {
                            sessionId: player.sessionId,
                            playerId: player.playerId,
                            value: buzzTextValue,
                          })
                          await refresh()
                        } catch (submitError) {
                          setError(submitError instanceof Error ? submitError.message : 'Could not submit answer')
                        } finally {
                          setBusy(false)
                        }
                      }}
                      type="button"
                    >
                      {t('play.sendAnswer')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {session.phase === 'review' && isBuzzMode ? (
              <div className="text-review-card">
                <div>
                  <strong>{t('play.yourAnswer')}</strong>
                  <p>{viewerAnswer?.submittedAnswer || '-'}</p>
                </div>
                <div>
                  <strong>{t('play.correctText')}</strong>
                  <p>{currentQuestion.correctAnswer || '-'}</p>
                </div>
                {currentQuestion.correctAnswerMediaType && currentQuestion.correctAnswerMediaType !== 'none' && currentQuestion.correctAnswerMediaUrl ? (
                  <div style={{ gridColumn: '1 / -1' }}>
                    {currentQuestion.correctAnswerMediaType === 'image' && (
                      <img
                        alt="Correct answer"
                        className="media-visual"
                        src={currentQuestion.correctAnswerMediaUrl}
                        style={{ maxHeight: '16rem', borderRadius: '0.75rem', width: '100%', objectFit: 'contain' }}
                      />
                    )}
                    {currentQuestion.correctAnswerMediaType === 'video' && (
                      <video className="media-visual" controls src={currentQuestion.correctAnswerMediaUrl} style={{ width: '100%', borderRadius: '0.75rem' }} />
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
          <span className="eyebrow">{t('play.yourSeat')}</span>
          <h3>{player.displayName}</h3>
          <p>{t('play.personalCode')}: <strong>{player.playerCode}</strong></p>
          <p>{t('play.score')}: <strong>{session?.viewerScore ?? 0}</strong></p>
          <div className="action-row">
            <Link className="ghost-button" to={`/leaderboard/${joinCode}`}>{t('play.openLeaderboard')}</Link>
          </div>
        </section>

        <section className="panel compact-panel">
          <span className="eyebrow">{t('play.liveBoard')}</span>
          <LeaderboardCard compact entries={session?.leaderboard || []} />
        </section>
      </aside>
    </div>
  )
}
