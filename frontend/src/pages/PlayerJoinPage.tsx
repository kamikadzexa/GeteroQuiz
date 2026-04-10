import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AvatarPicker } from '../components/player/AvatarPicker'
import { useI18n } from '../context/I18nContext'
import { usePlayerSessions } from '../context/PlayerSessionContext'
import { api } from '../services/api'
import type { PublicSessionSummary, SessionState } from '../types'

export function PlayerJoinPage() {
  const { t, language } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { sessions, upsertSession, pruneSessions, getSession, profile, saveProfile } = usePlayerSessions()

  const [joinCode, setJoinCode] = useState(params.get('code')?.toUpperCase() || '')
  const [displayName, setDisplayName] = useState(profile?.displayName || '')
  const [playerCode, setPlayerCode] = useState('')
  const [avatar, setAvatar] = useState(profile?.avatar || 'emoji:🎉')
  const [mode, setMode] = useState<'new' | 'rejoin'>('new')
  const [preview, setPreview] = useState<SessionState | null>(null)
  const [activeSessions, setActiveSessions] = useState<PublicSessionSummary[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const savedSeat = useMemo(() => (joinCode ? getSession(joinCode) : null), [getSession, joinCode])

  useEffect(() => {
    let active = true

    const loadActiveSessions = async () => {
      try {
        const items = await api.listPublicSessions()
        if (!active) return
        setActiveSessions(items)
        pruneSessions(items.map((item) => item.joinCode))
        setJoinCode((current) => (current || items[0]?.joinCode || ''))
      } catch {
        if (!active) return
        setActiveSessions([])
      }
    }

    void loadActiveSessions()

    const intervalId = window.setInterval(() => {
      void loadActiveSessions()
    }, 5000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadActiveSessions()
      }
    }

    window.addEventListener('focus', handleVisibilityChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      active = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleVisibilityChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [pruneSessions])

  useEffect(() => {
    if (!joinCode || joinCode.length < 5) {
      setPreview(null)
      return
    }

    const timeout = window.setTimeout(() => {
      api
        .getPublicSession(joinCode, savedSeat?.playerId)
        .then((session) => {
          setPreview(session)
          if (session.playerCount > 0 && savedSeat) {
            setMode('rejoin')
            setPlayerCode(savedSeat.playerCode)
            setDisplayName(savedSeat.displayName)
            setAvatar(savedSeat.avatar)
          }
        })
        .catch(() => setPreview(null))
    }, 200)

    return () => window.clearTimeout(timeout)
  }, [joinCode, savedSeat])

  const shouldPromptForMode = (preview?.playerCount || 0) > 0

  const handleSubmit = async () => {
    setError('')
    setSubmitting(true)

    try {
      const result =
        mode === 'rejoin'
          ? await api.rejoinSession(joinCode, {
              playerCode: playerCode || savedSeat?.playerCode || '',
            })
          : await api.joinSession(joinCode, {
              displayName,
              avatar,
              preferredLanguage: language,
            })

      saveProfile({
        displayName: result.player.displayName,
        avatar: result.player.avatar,
      })
      upsertSession(result.player)
      navigate(`/play/${result.player.joinCode}`)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="join-layout">
      <section className="panel hero-panel">
        <span className="eyebrow">{t('join.badge')}</span>
        <h1>{t('join.title')}</h1>
        <p className="lead">{t('join.subtitle')}</p>

        <div className="session-preview ribbon">
          <div>
            <strong>{preview?.title || t('join.previewFallback')}</strong>
            <span>
              {preview
                ? `${preview.mode.toUpperCase()} - ${preview.playerCount} ${t('join.playersOnline')}`
                : t('join.previewHint')}
            </span>
          </div>
          <span className="code-badge">{joinCode || 'CODE'}</span>
        </div>

        {savedSeat ? (
          <div className="helper-banner">
            <div>
              <strong>{t('join.savedIdentity')}</strong>
              <span>
                {savedSeat.displayName} - {savedSeat.playerCode}
              </span>
            </div>
          </div>
        ) : null}

        <div className="active-session-list">
          <div className="inline-header">
            <h3>{t('join.activeSessions')}</h3>
            <span className="chip">{activeSessions.length}</span>
          </div>
          {activeSessions.length === 0 ? (
            <p className="helper-text">{t('join.noActiveSessions')}</p>
          ) : (
            activeSessions.map((session) => (
              <button
                className={session.joinCode === joinCode ? 'session-card active' : 'session-card'}
                key={session.id}
                onClick={() => setJoinCode(session.joinCode)}
                type="button"
              >
                <div>
                  <strong>{session.title}</strong>
                  <span>
                    {session.mode.toUpperCase()} - {session.playerCount} {t('join.playersOnline')}
                  </span>
                </div>
                <span className="chip">{session.joinCode}</span>
              </button>
            ))
          )}
        </div>

        <div className="quick-links">
          {Object.values(sessions).map((session) => (
            <button
              className="ghost-card"
              key={`${session.joinCode}-${session.playerId}`}
              onClick={() => navigate(`/play/${session.joinCode}`)}
              type="button"
            >
              <strong>{session.displayName}</strong>
              <span>
                {session.joinCode} - {session.playerCode}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel form-panel">
        <label>
          <span>{t('join.sessionCode')}</span>
          <input
            inputMode="numeric"
            maxLength={5}
            onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, ''))}
            placeholder="12345"
            value={joinCode}
          />
        </label>

        {shouldPromptForMode ? (
          <div className="choice-grid">
            <button
              className={mode === 'new' ? 'mode-card active' : 'mode-card'}
              onClick={() => setMode('new')}
              type="button"
            >
              <strong>{t('join.joinAsNew')}</strong>
              <span>{t('join.joinAsNewHint')}</span>
            </button>
            <button
              className={mode === 'rejoin' ? 'mode-card active' : 'mode-card'}
              onClick={() => setMode('rejoin')}
              type="button"
            >
              <strong>{t('join.rejoinExisting')}</strong>
              <span>{t('join.rejoinExistingHint')}</span>
            </button>
          </div>
        ) : null}

        {mode === 'new' ? (
          <div className="form-grid">
            <label>
              <span>{t('join.displayName')}</span>
              <input
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t('join.displayNamePlaceholder')}
                value={displayName}
              />
            </label>

            <div>
              <span>{t('join.chooseAvatar')}</span>
              <AvatarPicker onChange={setAvatar} value={avatar} />
            </div>
          </div>
        ) : (
          <div className="form-grid">
            <label>
              <span>{t('join.personalCode')}</span>
              <input
                maxLength={4}
                onChange={(event) => setPlayerCode(event.target.value)}
                placeholder="1234"
                value={playerCode}
              />
            </label>
            {savedSeat ? (
              <p className="helper-text">
                {t('join.savedIdentity')} {savedSeat.displayName} - {savedSeat.playerCode}
              </p>
            ) : (
              <p className="helper-text">{t('join.rejoinNeedsCode')}</p>
            )}
          </div>
        )}

        {error ? <p className="error-text">{error}</p> : null}

        <button
          className="cta-button"
          disabled={
            submitting ||
            !joinCode ||
            (mode === 'new' ? !displayName.trim() : !(playerCode || savedSeat?.playerCode))
          }
          onClick={handleSubmit}
          type="button"
        >
          {submitting
            ? t('common.loading')
            : mode === 'rejoin'
              ? t('join.rejoinAction')
              : t('join.joinAction')}
        </button>

        <p className="helper-text">
          {t('join.adminPrompt')} <Link to="/admin">{t('nav.admin')}</Link>
        </p>
      </section>
    </div>
  )
}
