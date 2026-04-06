import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../context/I18nContext'
import { api } from '../services/api'
import type { QuizMode, QuizSummary, SessionSummary } from '../types'

export function AdminDashboardPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { token, user, login, register, logout, loading } = useAuth()
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [createTitle, setCreateTitle] = useState('')
  const [createMode, setCreateMode] = useState<QuizMode>('classic')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const importInputRef = useRef<HTMLInputElement | null>(null)

  function downloadBlob(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    window.URL.revokeObjectURL(url)
  }

  async function refreshDashboard() {
    if (!token) return
    const [nextQuizzes, nextSessions] = await Promise.all([api.listQuizzes(token), api.listSessions(token)])
    setQuizzes(nextQuizzes)
    setSessions(nextSessions)
  }

  useEffect(() => {
    if (!token) return
    refreshDashboard().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load dashboard')
    })
  }, [token])

  if (loading) {
    return <section className="panel">{t('common.loading')}</section>
  }

  if (!user || !token) {
    return (
      <section className="panel login-panel">
        <span className="eyebrow">{t('admin.badge')}</span>
        <h1>{authMode === 'login' ? t('admin.loginTitle') : t('admin.registerTitle')}</h1>
        <p className="lead">{authMode === 'login' ? t('admin.loginSubtitle') : t('admin.registerSubtitle')}</p>

        <div className="pill-row auth-switch-row">
          <button
            className={authMode === 'login' ? 'chip active' : 'chip'}
            onClick={() => {
              setAuthMode('login')
              setAuthError('')
              setAuthMessage('')
            }}
            type="button"
          >
            {t('admin.loginAction')}
          </button>
          <button
            className={authMode === 'register' ? 'chip active' : 'chip'}
            onClick={() => {
              setAuthMode('register')
              setAuthError('')
              setAuthMessage('')
            }}
            type="button"
          >
            {t('admin.registerAction')}
          </button>
        </div>

        <div className="form-grid">
          {authMode === 'register' ? (
            <label>
              <span>{t('admin.displayName')}</span>
              <input onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
            </label>
          ) : null}
          <label>
            <span>{t('admin.username')}</span>
            <input onChange={(event) => setUsername(event.target.value)} value={username} />
          </label>
          <label>
            <span>{t('admin.password')}</span>
            <input onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
          </label>
        </div>

        {authError ? <p className="error-text">{authError}</p> : null}
        {authMessage ? <p className="helper-text success-text">{authMessage}</p> : null}

        <button
          className="cta-button"
          onClick={async () => {
            try {
              setAuthError('')
              setAuthMessage('')
              if (authMode === 'login') {
                await login(username, password)
                return
              }

              const result = await register({
                username,
                displayName,
                password,
              })

              if (result.requiresApproval) {
                setAuthMessage(t('admin.registerPendingMessage'))
                setAuthMode('login')
                setPassword('')
              }
            } catch (authActionError) {
              setAuthError(authActionError instanceof Error ? authActionError.message : t('admin.authFailed'))
            }
          }}
          type="button"
        >
          {authMode === 'login' ? t('admin.loginAction') : t('admin.registerAction')}
        </button>
      </section>
    )
  }

  return (
    <div className="admin-dashboard-layout">
      <section className="panel">
        <div className="inline-header">
          <div>
            <span className="eyebrow">{t('admin.badge')}</span>
            <h1>{t('admin.dashboardTitle')}</h1>
          </div>
          <div className="action-row">
            {user.role === 'admin' ? (
              <Link className="ghost-button" to="/admin/users">
                {t('admin.manageUsers')}
              </Link>
            ) : null}
            <button className="ghost-button" onClick={logout} type="button">
              {t('admin.logout')}
            </button>
          </div>
        </div>
        <div className="pill-row">
          <span className="chip active">{user.displayName}</span>
          <span className="chip">{t(`admin.role.${user.role}`)}</span>
        </div>

        <div className="create-quiz-box admin-create-grid">
          <input
            onChange={(event) => setCreateTitle(event.target.value)}
            placeholder={t('admin.newQuizPlaceholder')}
            value={createTitle}
          />
          <select onChange={(event) => setCreateMode(event.target.value as QuizMode)} value={createMode}>
            <option value="classic">{t('admin.modeClassic')}</option>
            <option value="buzz">{t('admin.modeBuzz')}</option>
          </select>
          <button
            className="cta-button secondary"
            disabled={busy || !createTitle}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                const quiz = await api.createQuiz(token, {
                  title: createTitle,
                  description: '',
                  mode: createMode,
                })
                setCreateTitle('')
                await refreshDashboard()
                navigate(`/admin/quizzes/${quiz.id}`)
              } catch (createError) {
                setError(createError instanceof Error ? createError.message : 'Could not create quiz')
              } finally {
                setBusy(false)
              }
            }}
            type="button"
          >
            {t('admin.createQuiz')}
          </button>
        </div>

        <div className="action-row">
          <input
            accept=".zip,application/zip"
            className="visually-hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return

              setBusy(true)
              setError('')
              try {
                const importedQuiz = await api.importQuiz(token, file)
                await refreshDashboard()
                navigate(`/admin/quizzes/${importedQuiz.id}`)
              } catch (importError) {
                setError(importError instanceof Error ? importError.message : 'Could not import quiz')
              } finally {
                event.currentTarget.value = ''
                setBusy(false)
              }
            }}
            ref={importInputRef}
            type="file"
          />
          <button
            className="ghost-button"
            disabled={busy}
            onClick={() => importInputRef.current?.click()}
            type="button"
          >
            {t('editor.importQuiz')}
          </button>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        <div className="quiz-list">
          {quizzes.map((quiz) => (
            <article className="quiz-card" key={quiz.id}>
              <div>
                <span className="color-dot" style={{ backgroundColor: quiz.accentColor }} />
                <strong>{quiz.title}</strong>
              </div>
              <p>{quiz.description || t('admin.noDescription')}</p>
              <div className="pill-row">
                <span className="chip">{quiz.mode.toUpperCase()}</span>
                <span className="chip">{quiz.questionCount} Q</span>
              </div>
              <div className="action-row">
                <button
                  className="cta-button secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      const created = await api.createSession(token, quiz.id)
                      await refreshDashboard()
                      navigate(`/admin/sessions/${created.id}`)
                    } catch (createError) {
                      setError(createError instanceof Error ? createError.message : 'Could not start session')
                    } finally {
                      setBusy(false)
                    }
                  }}
                  type="button"
                >
                  {t('admin.startSession')}
                </button>
                <Link className="ghost-button" to={`/admin/quizzes/${quiz.id}`}>
                  {t('admin.editQuiz')}
                </Link>
                <button
                  className="ghost-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    setError('')
                    try {
                      const exported = await api.exportQuiz(token, quiz.id)
                      downloadBlob(exported.blob, exported.filename)
                    } catch (exportError) {
                      setError(exportError instanceof Error ? exportError.message : 'Could not export quiz')
                    } finally {
                      setBusy(false)
                    }
                  }}
                  type="button"
                >
                  {t('editor.exportQuiz')}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="inline-header">
          <h2>{t('admin.sessions')}</h2>
          <button className="ghost-button" onClick={() => refreshDashboard()} type="button">
            {t('admin.refresh')}
          </button>
        </div>
        <div className="session-grid">
          {sessions.map((session) => (
            <article className="session-card session-card-shell" key={session.id}>
              <div>
                <strong>{session.quiz.title}</strong>
                <span>
                  {session.joinCode} - {session.playerCount} {t('join.playersOnline')}
                </span>
              </div>
              <div className="pill-row">
                <span className="chip">{session.status}</span>
                <span className="chip">{session.phase}</span>
              </div>
              <div className="action-row">
                <Link className="ghost-button" to={`/admin/sessions/${session.id}`}>
                  {t('admin.openSession')}
                </Link>
                <button
                  className="ghost-button danger-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    setError('')
                    try {
                      await api.deleteSession(token, session.id)
                      await refreshDashboard()
                    } catch (deleteError) {
                      setError(deleteError instanceof Error ? deleteError.message : 'Could not remove session')
                    } finally {
                      setBusy(false)
                    }
                  }}
                  type="button"
                >
                  {t('admin.deleteSession')}
                </button>
              </div>
            </article>
          ))}
          {sessions.length === 0 ? <p className="helper-text">{t('admin.noSessionSelected')}</p> : null}
        </div>
      </section>
    </div>
  )
}
