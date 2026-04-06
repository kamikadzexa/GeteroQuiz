import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LeaderboardCard } from '../components/shared/LeaderboardCard'
import { useI18n } from '../context/I18nContext'
import { api } from '../services/api'
import type { SessionState } from '../types'

export function LeaderboardPage() {
  const { joinCode = '' } = useParams()
  const { t } = useI18n()
  const [session, setSession] = useState<SessionState | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .getPublicSession(joinCode)
      .then(setSession)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load leaderboard'))
  }, [joinCode])

  if (error) {
    return <section className="panel">{error}</section>
  }

  if (!session) {
    return <section className="panel">{t('common.loading')}</section>
  }

  const winner = session.leaderboard[0]

  return (
    <section className="panel leaderboard-page">
      <span className="eyebrow">{t('leaderboard.badge')}</span>
      <h1>{session.title}</h1>
      <p className="lead">{t('leaderboard.subtitle')}</p>

      {winner ? (
        <div className="winner-banner">
          <span>{t('leaderboard.winner')}</span>
          <strong>{winner.displayName}</strong>
          <span>{winner.score} pts</span>
        </div>
      ) : null}

      <LeaderboardCard entries={session.leaderboard} />

      <div className="action-row">
        <Link className="ghost-button" to={`/play/${joinCode}`}>
          {t('leaderboard.backToSession')}
        </Link>
        <Link className="cta-button secondary" to="/">
          {t('leaderboard.newJoin')}
        </Link>
      </div>
    </section>
  )
}
