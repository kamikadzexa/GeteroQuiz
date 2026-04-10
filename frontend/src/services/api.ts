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
export const MAX_UPLOAD_SIZE_MB = 300
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024

type UploadOptions = {
  token?: string
  onProgress?: (progress: number) => void
  quizPin?: string
}

type RequestOptions = RequestInit & {
  quizPin?: string
}

export function getUploadSizeError(file: File) {
  if (file.size <= MAX_UPLOAD_SIZE_BYTES) {
    return null
  }

  return `File is too large. Maximum upload size is ${MAX_UPLOAD_SIZE_MB} MB.`
}

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

async function request<T>(path: string, init?: RequestOptions, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.quizPin ? { 'X-Quiz-Pin': init.quizPin } : {}),
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

function upload<T>(path: string, file: File, options: UploadOptions = {}) {
  const { token, onProgress, quizPin } = options

  return new Promise<T>((resolve, reject) => {
    const formData = new FormData()
    formData.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}${path}`)
    xhr.responseType = 'text'

    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }
    if (quizPin) {
      xhr.setRequestHeader('X-Quiz-Pin', quizPin)
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress?.(Math.round((event.loaded / event.total) * 100))
    }

    xhr.onerror = () => {
      reject(new Error('Upload failed'))
    }

    xhr.onabort = () => {
      reject(new Error('Upload was cancelled'))
    }

    xhr.onload = () => {
      let payload: { message?: string } | T | null = null

      if (xhr.responseText) {
        try {
          payload = JSON.parse(xhr.responseText) as { message?: string } | T
        } catch {
          reject(new Error(xhr.responseText || 'Upload failed'))
          return
        }
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error((payload as { message?: string } | null)?.message || 'Upload failed'))
        return
      }

      onProgress?.(100)
      resolve(payload as T)
    }

    xhr.send(formData)
  })
}

export function assetUrl(path: string) {
  if (!path) return ''
  if (path.startsWith('http')) return path
  return new URL(path, window.location.origin).toString()
}

const quizPinStorageKey = (quizId: string | number) => `quiz-editor-pin:${quizId}`
const sessionPinStorageKey = (sessionId: string | number) => `session-editor-pin:${sessionId}`

export function getStoredQuizPin(quizId: string | number) {
  return localStorage.getItem(quizPinStorageKey(quizId)) || ''
}

export function setStoredQuizPin(quizId: string | number, quizPin: string) {
  const normalized = quizPin.trim()
  if (!normalized) {
    localStorage.removeItem(quizPinStorageKey(quizId))
    return
  }

  localStorage.setItem(quizPinStorageKey(quizId), normalized)
}

export function clearStoredQuizPin(quizId: string | number) {
  localStorage.removeItem(quizPinStorageKey(quizId))
}

export function getStoredSessionPin(sessionId: string | number) {
  return localStorage.getItem(sessionPinStorageKey(sessionId)) || ''
}

export function setStoredSessionPin(sessionId: string | number, quizPin: string) {
  const normalized = quizPin.trim()
  if (!normalized) {
    localStorage.removeItem(sessionPinStorageKey(sessionId))
    return
  }

  localStorage.setItem(sessionPinStorageKey(sessionId), normalized)
}

export function clearStoredSessionPin(sessionId: string | number) {
  localStorage.removeItem(sessionPinStorageKey(sessionId))
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
  getQuiz: (token: string, quizId: string, quizPin?: string) =>
    request<QuizDetail>(`/quizzes/${quizId}`, { quizPin }, token),
  createQuiz: (token: string, payload: Partial<QuizDetail> & { editorPin?: string }) =>
    request<QuizDetail>(
      '/quizzes',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),
  updateQuiz: (token: string, quizId: string | number, payload: Partial<QuizDetail> & { editorPin?: string }, quizPin?: string) =>
    request<QuizDetail>(
      `/quizzes/${quizId}`,
      { method: 'PUT', body: JSON.stringify(payload), quizPin },
      token,
    ),
  deleteQuiz: (token: string, quizId: string | number, quizPin?: string) =>
    request(
      `/quizzes/${quizId}`,
      { method: 'DELETE', quizPin },
      token,
    ),
  exportQuiz: async (token: string, quizId: string | number, quizPin?: string) => {
    const response = await fetch(`${API_BASE}/quizzes/${quizId}/export`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(quizPin ? { 'X-Quiz-Pin': quizPin } : {}),
      },
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null
      throw new Error(payload?.message || 'Quiz export failed')
    }

    const blob = await response.blob()
    const header = response.headers.get('Content-Disposition') || ''
    const filenameMatch = header.match(/filename=\"?([^"]+)\"?/)

    return {
      blob,
      filename: filenameMatch?.[1] || `quiz-${quizId}.zip`,
    }
  },
  importQuiz: (token: string, file: File, onProgress?: (progress: number) => void) =>
    upload<QuizDetail>('/quizzes/import', file, { token, onProgress }),
  createQuestion: (
    token: string,
    quizId: string | number,
    payload: Partial<QuizDetail['questions'][number]>,
    quizPin?: string,
  ) =>
    request(
      `/quizzes/${quizId}/questions`,
      { method: 'POST', body: JSON.stringify(payload), quizPin },
      token,
    ),
  updateQuestion: (
    token: string,
    quizId: string | number,
    questionId: string | number,
    payload: Partial<QuizDetail['questions'][number]>,
    quizPin?: string,
  ) =>
    request(
      `/quizzes/${quizId}/questions/${questionId}`,
      { method: 'PUT', body: JSON.stringify(payload), quizPin },
      token,
    ),
  deleteQuestion: (token: string, quizId: string | number, questionId: string | number, quizPin?: string) =>
    request(
      `/quizzes/${quizId}/questions/${questionId}`,
      { method: 'DELETE', quizPin },
      token,
    ),
  listSessions: (token: string) => request<SessionSummary[]>('/sessions/admin', undefined, token),
  listPublicSessions: () => request<PublicSessionSummary[]>('/sessions/public-active'),
  createSession: (token: string, quizId: number, quizPin?: string) =>
    request<{ id: number; joinCode: string }>(
      '/sessions',
      { method: 'POST', body: JSON.stringify({ quizId }), quizPin },
      token,
    ),
  getAdminSession: (token: string, sessionId: string | number, quizPin?: string) =>
    request<AdminSessionState>(`/sessions/${sessionId}/admin`, { quizPin }, token),
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
  advanceSession: (token: string, sessionId: number, quizPin?: string) =>
    request(`/sessions/${sessionId}/advance`, { method: 'POST', quizPin }, token),
  closeQuestion: (token: string, sessionId: number, quizPin?: string) =>
    request(`/sessions/${sessionId}/close`, { method: 'POST', quizPin }, token),
  finishSession: (token: string, sessionId: number, quizPin?: string) =>
    request(`/sessions/${sessionId}/finish`, { method: 'POST', quizPin }, token),
  replayQuestion: (token: string, sessionId: number, quizPin?: string) =>
    request(`/sessions/${sessionId}/replay`, { method: 'POST', quizPin }, token),
  updateAutoAdvance: (
    token: string,
    sessionId: number,
    payload: { enabled?: boolean; paused?: boolean; durationSeconds?: number; answerDurationSeconds?: number },
    quizPin?: string,
  ) => request<AdminSessionState>(`/sessions/${sessionId}/auto-advance`, { method: 'POST', body: JSON.stringify(payload), quizPin }, token),
  judgeAnswer: (token: string, sessionId: number, answerId: number, isCorrect: boolean, quizPin?: string) =>
    request(
      `/sessions/${sessionId}/answers/${answerId}/judge`,
      { method: 'POST', body: JSON.stringify({ isCorrect }), quizPin },
      token,
    ),
  judgeBuzz: (token: string, sessionId: number, isCorrect: boolean, quizPin?: string) =>
    request(
      `/sessions/${sessionId}/buzz/judge`,
      { method: 'POST', body: JSON.stringify({ isCorrect }), quizPin },
      token,
    ),
  kickPlayer: (token: string, sessionId: number, playerId: number, quizPin?: string) =>
    request(`/sessions/${sessionId}/players/${playerId}`, { method: 'DELETE', quizPin }, token),
  adjustScore: (token: string, sessionId: number, playerId: number, delta: number, quizPin?: string) =>
    request<{ points: number }>(
      `/sessions/${sessionId}/players/${playerId}/adjust-score`,
      { method: 'POST', body: JSON.stringify({ delta }), quizPin },
      token,
    ),
  assignBoardSelector: (token: string, sessionId: number, playerId: number, quizPin?: string) =>
    request(
      `/sessions/${sessionId}/board/assign-selector`,
      { method: 'POST', body: JSON.stringify({ playerId }), quizPin },
      token,
    ),
  selectBoardQuestion: (token: string, sessionId: number, questionId: number, quizPin?: string) =>
    request(
      `/sessions/${sessionId}/board/select-question`,
      { method: 'POST', body: JSON.stringify({ questionId }), quizPin },
      token,
    ),
  assignCatInBag: (token: string, sessionId: number, playerId: number, quizPin?: string) =>
    request(
      `/sessions/${sessionId}/board/assign-cat-in-bag`,
      { method: 'POST', body: JSON.stringify({ playerId }), quizPin },
      token,
    ),
  closeStakesWager: (token: string, sessionId: number, quizPin?: string) =>
    request(`/sessions/${sessionId}/board/close-stakes`, { method: 'POST', quizPin }, token),
  deleteSession: (token: string, sessionId: number, quizPin?: string) =>
    request(`/sessions/${sessionId}`, { method: 'DELETE', quizPin }, token),
  uploadAvatar: (file: File, onProgress?: (progress: number) => void) =>
    upload<{ url: string }>('/uploads/avatar', file, { onProgress }),
  uploadQuizMedia: (
    token: string,
    quizId: string | number,
    file: File,
    onProgress?: (progress: number) => void,
    quizPin?: string,
  ) =>
    upload<{ url: string }>(`/quizzes/${quizId}/media`, file, { token, onProgress, quizPin }),
}
