import {
  clearStoredQuizPin,
  clearStoredSessionPin,
  getStoredQuizPin,
  getStoredSessionPin,
  setStoredQuizPin,
  setStoredSessionPin,
} from '../services/api'

function isQuizPinError(error: unknown) {
  return error instanceof Error && /Quiz PIN/i.test(error.message)
}

export function promptForQuizPin(message: string) {
  const input = window.prompt(message, '')
  if (input == null) {
    return null
  }

  return input.trim()
}

export async function withQuizPin<T>(
  quizId: string | number,
  action: (quizPin?: string) => Promise<T>,
  promptMessage: string,
) {
  let quizPin = getStoredQuizPin(quizId) || undefined

  try {
    const result = await action(quizPin)
    if (quizPin) {
      setStoredQuizPin(quizId, quizPin)
    }
    return result
  } catch (error) {
    if (!isQuizPinError(error)) {
      throw error
    }

    clearStoredQuizPin(quizId)
    const enteredPin = promptForQuizPin(promptMessage)
    if (enteredPin == null) {
      throw error
    }

    const retried = await action(enteredPin || undefined)
    if (enteredPin) {
      setStoredQuizPin(quizId, enteredPin)
    }
    return retried
  }
}

export async function withSessionPin<T>(
  sessionId: string | number,
  fallbackQuizId: string | number | undefined,
  action: (quizPin?: string) => Promise<T>,
  promptMessage: string,
) {
  let quizPin = getStoredSessionPin(sessionId) || (fallbackQuizId != null ? getStoredQuizPin(fallbackQuizId) : '') || undefined

  try {
    const result = await action(quizPin)
    if (quizPin) {
      setStoredSessionPin(sessionId, quizPin)
      if (fallbackQuizId != null) {
        setStoredQuizPin(fallbackQuizId, quizPin)
      }
    }
    return result
  } catch (error) {
    if (!isQuizPinError(error)) {
      throw error
    }

    clearStoredSessionPin(sessionId)
    if (fallbackQuizId != null) {
      clearStoredQuizPin(fallbackQuizId)
    }

    const enteredPin = promptForQuizPin(promptMessage)
    if (enteredPin == null) {
      throw error
    }

    const retried = await action(enteredPin || undefined)
    if (enteredPin) {
      setStoredSessionPin(sessionId, enteredPin)
      if (fallbackQuizId != null) {
        setStoredQuizPin(fallbackQuizId, enteredPin)
      }
    }
    return retried
  }
}
