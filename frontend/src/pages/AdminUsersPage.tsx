import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../context/I18nContext'
import { api } from '../services/api'
import type { AdminUser } from '../types'

type UserDraft = {
  username: string
  displayName: string
  password: string
  role: AdminUser['role']
  status: AdminUser['status']
}

function createDraft(user: AdminUser): UserDraft {
  return {
    username: user.username,
    displayName: user.displayName,
    password: '',
    role: user.role,
    status: user.status,
  }
}

export function AdminUsersPage() {
  const { t } = useI18n()
  const { token, user, loading, refreshUser } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [drafts, setDrafts] = useState<Record<number, UserDraft>>({})
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')

  async function refreshUsers() {
    if (!token) return
    const nextUsers = await api.listUsers(token)
    setUsers(nextUsers)
    setDrafts(Object.fromEntries(nextUsers.map((entry) => [entry.id, createDraft(entry)])))
  }

  useEffect(() => {
    if (!token || user?.role !== 'admin') return
    refreshUsers().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load users')
    })
  }, [token, user?.role])

  const pendingCount = useMemo(
    () => users.filter((entry) => entry.status === 'pending').length,
    [users],
  )

  if (loading) {
    return <section className="panel">{t('common.loading')}</section>
  }

  if (!token || !user) {
    return (
      <section className="panel">
        <Link className="ghost-button" to="/admin">
          {t('admin.loginAction')}
        </Link>
      </section>
    )
  }

  if (user.role !== 'admin') {
    return (
      <section className="panel">
        <div className="inline-header">
          <h1>{t('admin.userManagement')}</h1>
          <Link className="ghost-button" to="/admin">
            {t('admin.backToDashboard')}
          </Link>
        </div>
        <p className="error-text">{t('admin.usersAccessDenied')}</p>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="inline-header">
        <div>
          <span className="eyebrow">{t('admin.manageUsers')}</span>
          <h1>{t('admin.userManagement')}</h1>
        </div>
        <div className="action-row">
          <span className="chip active">{pendingCount} {t('admin.pending')}</span>
          <Link className="ghost-button" to="/admin">
            {t('admin.backToDashboard')}
          </Link>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="user-card-list">
        {users.map((entry) => {
          const draft = drafts[entry.id] ?? createDraft(entry)

          return (
            <article className="question-editor-card user-card" key={entry.id}>
              <div className="inline-header">
                <div>
                  <strong>{entry.displayName}</strong>
                  <p className="helper-text">
                    {entry.username} - {t(`admin.role.${entry.role}`)} - {t(`admin.status.${entry.status}`)}
                  </p>
                </div>
                <div className="pill-row">
                  {entry.status === 'pending' ? (
                    <button
                      className="ghost-button"
                      disabled={busyId === entry.id}
                      onClick={async () => {
                        if (!token) return
                        setBusyId(entry.id)
                        setError('')
                        try {
                          await api.updateUser(token, entry.id, { role: 'editor', status: 'active' })
                          await refreshUsers()
                          await refreshUser()
                        } catch (saveError) {
                          setError(saveError instanceof Error ? saveError.message : 'Could not update user')
                        } finally {
                          setBusyId(null)
                        }
                      }}
                      type="button"
                    >
                      {t('admin.approveEditor')}
                    </button>
                  ) : null}
                  <button
                    className="cta-button secondary"
                    disabled={busyId === entry.id}
                    onClick={async () => {
                      if (!token) return
                      setBusyId(entry.id)
                      setError('')
                      try {
                        await api.updateUser(token, entry.id, { role: 'admin', status: 'active' })
                        await refreshUsers()
                        await refreshUser()
                      } catch (saveError) {
                        setError(saveError instanceof Error ? saveError.message : 'Could not update user')
                      } finally {
                        setBusyId(null)
                      }
                    }}
                    type="button"
                  >
                    {t('admin.promoteAdmin')}
                  </button>
                </div>
              </div>

              <div className="editor-grid">
                <label>
                  <span>{t('admin.displayName')}</span>
                  <input
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [entry.id]: { ...draft, displayName: event.target.value },
                      }))
                    }
                    value={draft.displayName}
                  />
                </label>
                <label>
                  <span>{t('admin.username')}</span>
                  <input
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [entry.id]: { ...draft, username: event.target.value },
                      }))
                    }
                    value={draft.username}
                  />
                </label>
                <label>
                  <span>{t('admin.userRole')}</span>
                  <select
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [entry.id]: { ...draft, role: event.target.value as AdminUser['role'] },
                      }))
                    }
                    value={draft.role}
                  >
                    <option value="editor">{t('admin.role.editor')}</option>
                    <option value="admin">{t('admin.role.admin')}</option>
                  </select>
                </label>
                <label>
                  <span>{t('admin.userStatus')}</span>
                  <select
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [entry.id]: { ...draft, status: event.target.value as AdminUser['status'] },
                      }))
                    }
                    value={draft.status}
                  >
                    <option value="pending">{t('admin.status.pending')}</option>
                    <option value="active">{t('admin.status.active')}</option>
                  </select>
                </label>
                <label className="user-password-row">
                  <span>{t('admin.newPassword')}</span>
                  <input
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [entry.id]: { ...draft, password: event.target.value },
                      }))
                    }
                    placeholder={t('admin.passwordOptional')}
                    type="password"
                    value={draft.password}
                  />
                </label>
              </div>

              <div className="action-row">
                <button
                  className="cta-button"
                  disabled={busyId === entry.id}
                  onClick={async () => {
                    if (!token) return
                    setBusyId(entry.id)
                    setError('')
                    try {
                      await api.updateUser(token, entry.id, draft)
                      await refreshUsers()
                      await refreshUser()
                    } catch (saveError) {
                      setError(saveError instanceof Error ? saveError.message : 'Could not update user')
                    } finally {
                      setBusyId(null)
                    }
                  }}
                  type="button"
                >
                  {t('admin.saveUser')}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
