import type {
  AdminSessionState,
  AdminUser,
  AuthResult,
  PlayerRecord,
  PublicSessionSummary,
  QuizDetail,
  QuizSummary,
  SessionState,
  SessionSummary,
} from '../types'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

function normalizePlayerRecord(player: Partial<PlayerRecord> & { id?: number; playerId?: number }): PlayerRecord {
  return {
    ...player,
    playerId: Number(player.playerId ?? player.id),
    sessionId: Number(player.sessionId),
    joinCode: String(player.joinCode ?? '').toUpperCase(),
    displayName: String(player.displayName ?? ''),
    avatar: String(player.avatar ?? 'emoji:🎉'),
    preferredLanguage: (player.preferredLanguage ?? 'en') as PlayerRecord['preferredLanguage'],
    playerCode: String(player.playerCode ?? player.rejoinCode ?? ''),
  }
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(payload?.message || 'Request failed')
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export function assetUrl(path: string) {
  if (!path) return ''
  if (path.startsWith('http')) return path
  return new URL(path, window.location.origin).toString()
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; user: AdminUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  register: (payload: { username: string; displayName: string; password: string }) =>
    request<AuthResult>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  me: (token: string) => request<AdminUser>('/auth/me', undefined, token),
  listUsers: (token: string) => request<AdminUser[]>('/users', undefined, token),
  updateUser: (
    token: string,
    userId: number,
    payload: Partial<Pick<AdminUser, 'username' | 'displayName' | 'role' | 'status'>> & { password?: string },
  ) => request<AdminUser>(`/users/${userId}`, { method: 'PUT', body: JSON.stringify(payload) }, token),
  listQuizzes: (token: string) => request<QuizSummary[]>('/quizzes', undefined, token),
  getQuiz: (token: string, quizId: string) => request<QuizDetail>(`/quizzes/${quizId}`, undefined, token),
  createQuiz: (token: string, payload: Partial<QuizDetail>) =>
    request<QuizDetail>(
      '/quizzes',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),
  updateQuiz: (token: string, quizId: string | number, payload: Partial<QuizDetail>) =>
    request<QuizDetail>(
      `/quizzes/${quizId}`,
      { method: 'PUT', body: JSON.stringify(payload) },
      token,
    ),
  exportQuiz: async (token: string, quizId: string | number) => {
    const response = await fetch(`${API_BASE}/quizzes/${quizId}/export`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error('Quiz export failed')
    }

    const blob = await response.blob()
    const header = response.headers.get('Content-Disposition') || ''
    const filenameMatch = header.match(/filename=\"?([^"]+)\"?/)

    return {
      blob,
      filename: filenameMatch?.[1] || `quiz-${quizId}.zip`,
    }
  },
  importQuiz: async (token: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${API_BASE}/quizzes/import`, {
      method: 'POST',
      body: formData,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null
      throw new Error(payload?.message || 'Quiz import failed')
    }

    return (await response.json()) as QuizDetail
  },
  createQuestion: (token: string, quizId: string | number, payload: Partial<QuizDetail['questions'][number]>) =>
    request(
      `/quizzes/${quizId}/questions`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),
  updateQuestion: (
    token: string,
    quizId: string | number,
    questionId: string | number,
    payload: Partial<QuizDetail['questions'][number]>,
  ) =>
    request(
      `/quizzes/${quizId}/questions/${questionId}`,
      { method: 'PUT', body: JSON.stringify(payload) },
      token,
    ),
  deleteQuestion: (token: string, quizId: string | number, questionId: string | number) =>
    request(
      `/quizzes/${quizId}/questions/${questionId}`,
      { method: 'DELETE' },
      token,
    ),
  listSessions: (token: string) => request<SessionSummary[]>('/sessions/admin', undefined, token),
  listPublicSessions: () => request<PublicSessionSummary[]>('/sessions/public-active'),
  createSession: (token: string, quizId: number) =>
    request<{ id: number; joinCode: string }>(
      '/sessions',
      { method: 'POST', body: JSON.stringify({ quizId }) },
      token,
    ),
  getAdminSession: (token: string, sessionId: string | number) =>
    request<AdminSessionState>(`/sessions/${sessionId}/admin`, undefined, token),
  getPublicSession: (joinCode: string, playerId?: number) =>
    request<SessionState>(
      `/sessions/by-code/${joinCode.toUpperCase()}${playerId ? `?playerId=${playerId}` : ''}`,
    ),
  joinSession: (
    joinCode: string,
    payload: { displayName: string; avatar: string; preferredLanguage: string },
  ) =>
    request<{ player: PlayerRecord; session: SessionState }>(
      `/sessions/${joinCode.toUpperCase()}/join`,
      { method: 'POST', body: JSON.stringify(payload) },
    ).then((result) => ({
      ...result,
      player: normalizePlayerRecord(result.player),
    })),
  rejoinSession: (joinCode: string, payload: { playerCode: string }) =>
    request<{ player: PlayerRecord; session: SessionState }>(
      `/sessions/${joinCode.toUpperCase()}/rejoin`,
      { method: 'POST', body: JSON.stringify(payload) },
    ).then((result) => ({
      ...result,
      player: normalizePlayerRecord(result.player),
    })),
  advanceSession: (token: string, sessionId: number) =>
    request(`/sessions/${sessionId}/advance`, { method: 'POST' }, token),
  closeQuestion: (token: string, sessionId: number) =>
    request(`/sessions/${sessionId}/close`, { method: 'POST' }, token),
  finishSession: (token: string, sessionId: number) =>
    request(`/sessions/${sessionId}/finish`, { method: 'POST' }, token),
  replayQuestion: (token: string, sessionId: number) =>
    request(`/sessions/${sessionId}/replay`, { method: 'POST' }, token),
  updateAutoAdvance: (
    token: string,
    sessionId: number,
    payload: { enabled?: boolean; paused?: boolean; durationSeconds?: number; answerDurationSeconds?: number },
  ) => request<AdminSessionState>(`/sessions/${sessionId}/auto-advance`, { method: 'POST', body: JSON.stringify(payload) }, token),
  judgeAnswer: (token: string, sessionId: number, answerId: number, isCorrect: boolean) =>
    request(
      `/sessions/${sessionId}/answers/${answerId}/judge`,
      { method: 'POST', body: JSON.stringify({ isCorrect }) },
      token,
    ),
  judgeBuzz: (token: string, sessionId: number, isCorrect: boolean) =>
    request(
      `/sessions/${sessionId}/buzz/judge`,
      { method: 'POST', body: JSON.stringify({ isCorrect }) },
      token,
    ),
  kickPlayer: (token: string, sessionId: number, playerId: number) =>
    request(`/sessions/${sessionId}/players/${playerId}`, { method: 'DELETE' }, token),
  deleteSession: (token: string, sessionId: number) =>
    request(`/sessions/${sessionId}`, { method: 'DELETE' }, token),
  uploadAvatar: async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${API_BASE}/uploads/avatar`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      throw new Error('Avatar upload failed')
    }

    return (await response.json()) as { url: string }
  },
  uploadQuizMedia: async (token: string, quizId: string | number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${API_BASE}/quizzes/${quizId}/media`, {
      method: 'POST',
      body: formData,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error('Media upload failed')
    }

    return (await response.json()) as { url: string }
  },
}
