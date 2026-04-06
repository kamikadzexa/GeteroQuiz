import {
  createContext,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import type { PlayerRecord } from '../types'
import { deleteCookie, getJsonCookie, setJsonCookie } from '../utils/cookies'

type PlayerSessionMap = Record<string, PlayerRecord>
type PlayerProfile = {
  displayName: string
  avatar: string
}

interface PlayerSessionContextValue {
  sessions: PlayerSessionMap
  upsertSession: (session: PlayerRecord) => void
  removeSession: (joinCode: string) => void
  pruneSessions: (activeJoinCodes: string[]) => void
  getSession: (joinCode: string) => PlayerRecord | null
  profile: PlayerProfile | null
  saveProfile: (profile: PlayerProfile) => void
}

const PlayerSessionContext = createContext<PlayerSessionContextValue | null>(null)
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

function normalizeStoredSession(value: unknown): PlayerRecord | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Partial<PlayerRecord> & {
    id?: number
    playerId?: number
    rejoinCode?: string
  }

  const playerId = Number(record.playerId ?? record.id)
  const sessionId = Number(record.sessionId)
  const joinCode = String(record.joinCode ?? '').toUpperCase()
  const playerCode = String(record.playerCode ?? record.rejoinCode ?? '')

  if (!playerId || !sessionId || !joinCode || !playerCode) {
    return null
  }

  return {
    id: record.id,
    playerId,
    sessionId,
    joinCode,
    displayName: String(record.displayName ?? ''),
    avatar: String(record.avatar ?? 'emoji:🎉'),
    preferredLanguage: (record.preferredLanguage ?? 'en') as PlayerRecord['preferredLanguage'],
    playerCode,
  }
}

function normalizeSessionMap(value: unknown): PlayerSessionMap {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => {
      const normalized = normalizeStoredSession(item)
      return normalized ? [key.toUpperCase(), normalized] : null
    })
    .filter(Boolean) as Array<[string, PlayerRecord]>

  return Object.fromEntries(entries)
}

export function PlayerSessionProvider({ children }: PropsWithChildren) {
  const [sessions, setSessions] = useState<PlayerSessionMap>(() => {
    return normalizeSessionMap(getJsonCookie<PlayerSessionMap>('quiz-player-sessions'))
  })
  const [profile, setProfile] = useState<PlayerProfile | null>(() =>
    getJsonCookie<PlayerProfile>('quiz-player-profile'),
  )

  const value = useMemo<PlayerSessionContextValue>(
    () => ({
      sessions,
      upsertSession: (session) => {
        setSessions((current) => {
          const normalized = normalizeStoredSession(session)
          if (!normalized) {
            return current
          }

          const next = { ...current, [normalized.joinCode]: normalized }
          setJsonCookie('quiz-player-sessions', next, COOKIE_MAX_AGE)
          return next
        })
      },
      removeSession: (joinCode) => {
        setSessions((current) => {
          const next = { ...current }
          delete next[joinCode.toUpperCase()]
          if (Object.keys(next).length === 0) {
            deleteCookie('quiz-player-sessions')
          } else {
            setJsonCookie('quiz-player-sessions', next, COOKIE_MAX_AGE)
          }
          return next
        })
      },
      pruneSessions: (activeJoinCodes) => {
        const normalizedActiveCodes = new Set(activeJoinCodes.map((code) => code.toUpperCase()))
        setSessions((current) => {
          const nextEntries = Object.entries(current).filter(([joinCode]) => normalizedActiveCodes.has(joinCode))
          if (nextEntries.length === Object.keys(current).length) {
            return current
          }

          const next = Object.fromEntries(nextEntries)
          if (Object.keys(next).length === 0) {
            deleteCookie('quiz-player-sessions')
          } else {
            setJsonCookie('quiz-player-sessions', next, COOKIE_MAX_AGE)
          }
          return next
        })
      },
      getSession: (joinCode) => sessions[joinCode.toUpperCase()] || null,
      profile,
      saveProfile: (nextProfile) => {
        setProfile(nextProfile)
        setJsonCookie('quiz-player-profile', nextProfile, COOKIE_MAX_AGE)
      },
    }),
    [profile, sessions],
  )

  return <PlayerSessionContext.Provider value={value}>{children}</PlayerSessionContext.Provider>
}

export function usePlayerSessions() {
  const context = useContext(PlayerSessionContext)
  if (!context) throw new Error('usePlayerSessions must be used inside PlayerSessionProvider')
  return context
}
