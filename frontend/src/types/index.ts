export type Language = 'en' | 'ru'
export type QuizMode = 'classic' | 'buzz'
export type SessionPhase = 'waiting' | 'open' | 'review' | 'finished'
export type SessionStatus = 'lobby' | 'live' | 'finished'
export type QuestionType = 'multiple_choice' | 'text'
export type MediaType = 'none' | 'image' | 'audio' | 'video'

export interface QuestionOption {
  id: string
  text: string
}

export interface Question {
  id: number
  prompt: string
  helpText: string
  type: QuestionType
  order: number
  options: QuestionOption[]
  mediaType: MediaType
  mediaUrl: string
  mediaVersion?: number | null
  timeLimitSeconds: number
  points: number
  penaltyPoints: number
  correctAnswer?: string
}

export interface LeaderboardEntry {
  playerId: number
  displayName: string
  avatar: string
  score: number
  isConnected: boolean
}

export interface SessionState {
  id: number
  joinCode: string
  status: SessionStatus
  phase: SessionPhase
  mode: QuizMode
  title: string
  description: string
  accentColor: string
  currentQuestionIndex: number
  totalQuestions: number
  playerCount: number
  connectedPlayerCount: number
  currentQuestion: Question | null
  serverNow: string
  closesAt: string | null
  questionRemainingSeconds: number
  answerDurationSeconds: number
  autoAdvanceAt: string | null
  autoAdvanceEnabled: boolean
  autoAdvancePaused: boolean
  autoAdvanceDurationSeconds: number
  autoAdvanceRemainingSeconds: number
  answerCount: number
  leaderboard: LeaderboardEntry[]
  lockedBuzzPlayer: {
    playerId: number
    displayName: string
  } | null
  deniedBuzzPlayerIds: number[]
  viewerAnswer: {
    submittedAnswer: string
    status: 'submitted' | 'judged'
    isCorrect: boolean | null
    awardedPoints: number
  } | null
  viewerScore: number | null
}

export interface AdminPlayer {
  id: number
  displayName: string
  avatar: string
  playerCode: string
  preferredLanguage: Language
  isConnected: boolean
  lastSeenAt: string | null
}

export interface AdminAnswer {
  id: number
  playerId: number
  playerName: string
  avatar: string
  submittedAnswer: string
  isCorrect: boolean | null
  status: 'submitted' | 'judged'
  awardedPoints: number
  submittedAt: string | null
  suggestedCorrect: boolean
}

export interface AdminSessionState extends SessionState {
  players: AdminPlayer[]
  answers: AdminAnswer[]
  buzzAttemptText: string
  activeBuzzPlayerId: number | null
}

export interface QuizSummary {
  id: number
  title: string
  description: string
  mode: QuizMode
  accentColor: string
  isPublished: boolean
  hasEditorPin: boolean
  questionCount: number
  updatedAt: string
}

export interface QuizDetail {
  id: number
  title: string
  description: string
  mode: QuizMode
  accentColor: string
  isPublished: boolean
  hasEditorPin: boolean
  questions: Question[]
}

export interface SessionSummary {
  id: number
  joinCode: string
  status: SessionStatus
  phase: SessionPhase
  currentQuestionIndex: number
  playerCount: number
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  quiz: {
    id: number
    title: string
    mode: QuizMode
    accentColor: string
    hasEditorPin?: boolean
  }
}

export interface PublicSessionSummary {
  id: number
  joinCode: string
  status: SessionStatus
  phase: SessionPhase
  title: string
  description: string
  mode: QuizMode
  accentColor: string
  currentQuestionIndex: number
  totalQuestions: number
  playerCount: number
  connectedPlayerCount: number
}

export interface AdminUser {
  id: number
  username: string
  displayName: string
  role: 'admin' | 'editor'
  status: 'pending' | 'active'
  createdAt: string
  updatedAt: string
}

export interface AuthResult {
  token: string | null
  user: AdminUser
  requiresApproval: boolean
}

export interface PlayerRecord {
  id?: number
  playerId: number
  sessionId: number
  joinCode: string
  displayName: string
  avatar: string
  preferredLanguage: Language
  playerCode: string
  rejoinCode?: string
}
