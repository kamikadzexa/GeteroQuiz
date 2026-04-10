import { assetUrl } from '../../services/api'
import type { LeaderboardEntry } from '../../types'

function Avatar({ avatar, name }: { avatar: string; name: string }) {
  if (avatar.startsWith('emoji:')) {
    return <span className="avatar emoji">{avatar.replace('emoji:', '')}</span>
  }

  return <img alt={name} className="avatar" src={assetUrl(avatar)} />
}

export function LeaderboardCard({
  entries,
  compact = false,
}: {
  entries: LeaderboardEntry[]
  compact?: boolean
}) {
  return (
    <div className={compact ? 'leaderboard compact' : 'leaderboard'}>
      {entries.map((entry, index) => (
        <div className="leaderboard-row" key={entry.playerId}>
          <span className="rank">#{index + 1}</span>
          <div className="leaderboard-player">
            <Avatar avatar={entry.avatar} name={entry.displayName} />
            <div className="leaderboard-player-info">
              <strong>{entry.displayName}</strong>
              <span className={entry.isConnected ? 'player-status online' : 'player-status away'}>
                {entry.isConnected ? 'Online' : 'Away'}
              </span>
            </div>
          </div>
          <strong className="score">{entry.score}</strong>
        </div>
      ))}
    </div>
  )
}
