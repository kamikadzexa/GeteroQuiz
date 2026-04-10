import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { QuestionMedia } from '../components/shared/QuestionMedia'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../context/I18nContext'
import { api, getStoredQuizPin, getUploadSizeError, MAX_UPLOAD_SIZE_MB, setStoredQuizPin } from '../services/api'
import type { MediaType, Question, QuestionOption, QuestionType, QuizBoardRound, QuizDetail } from '../types'
import { withQuizPin } from '../utils/quizPin'

const ACCENT_PRESETS = ['#ff7a59', '#ff5f6d', '#ffb347', '#3fb7a1', '#2f8cff', '#6658f5', '#111827', '#f97316']
const AUTOSAVE_DELAY_MS = 700

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

function createOptionLabel(index: number) {
  let cursor = index
  let label = ''

  do {
    label = String.fromCharCode(65 + (cursor % 26)) + label
    cursor = Math.floor(cursor / 26) - 1
  } while (cursor >= 0)

  return label
}

function createDefaultOptions(count = 4): QuestionOption[] {
  return Array.from({ length: count }, (_, index) => ({
    id: createOptionLabel(index),
    text: '',
  }))
}

function getNextOptionId(options: QuestionOption[]) {
  let index = 0

  while (options.some((option) => option.id === createOptionLabel(index))) {
    index += 1
  }

  return createOptionLabel(index)
}

function createEntityId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function createBoardColumn(name = '') {
  return {
    id: createEntityId('column'),
    name,
  }
}

function createBoardRound(index: number) {
  return {
    id: createEntityId('round'),
    name: `Round ${index + 1}`,
    columns: [],
  }
}

function sanitizeBoardLayout(layout: QuizBoardRound[] | undefined): QuizBoardRound[] {
  if (!Array.isArray(layout)) return []

  return layout.map((round, roundIndex) => ({
    id: round.id || createEntityId('round'),
    name: round.name || `Round ${roundIndex + 1}`,
    columns: Array.isArray(round.columns)
      ? round.columns.map((column, columnIndex) => ({
          id: column.id || createEntityId('column'),
          name: column.name || `Column ${columnIndex + 1}`,
        }))
      : [],
  }))
}

function buildCollapsedState(questions: QuizDetail['questions'] | undefined, collapsed = true) {
  return Object.fromEntries((questions ?? []).map((question) => [question.id, collapsed]))
}

function sanitizeQuestion(question: Question): Question {
  const safePoints = Number.isFinite(question.points) ? Math.max(0, question.points) : 100
  const safePenalty = Number.isFinite(question.penaltyPoints) ? Math.max(0, question.penaltyPoints) : 100
  const safeTimer = Number.isFinite(question.timeLimitSeconds) ? Math.max(0, question.timeLimitSeconds) : 20
  const safeCorrectAnswerMediaType = question.correctAnswerMediaType ?? 'none'
  const safeCorrectAnswerMediaUrl = safeCorrectAnswerMediaType === 'none' ? '' : (question.correctAnswerMediaUrl ?? '')

  if (question.type === 'text') {
    return {
      ...question,
      options: [],
      mediaUrl: question.mediaType === 'none' ? '' : question.mediaUrl,
      points: safePoints,
      penaltyPoints: safePenalty,
      timeLimitSeconds: safeTimer,
      correctAnswer: question.correctAnswer || '',
      correctAnswerMediaType: safeCorrectAnswerMediaType,
      correctAnswerMediaUrl: safeCorrectAnswerMediaUrl,
      columnName: question.columnName || '',
      specialType: question.specialType || 'normal',
    }
  }

  const safeOptions = question.options.length > 0 ? question.options : createDefaultOptions(4)
  const correctAnswer = safeOptions.some((option) => option.id === question.correctAnswer)
    ? question.correctAnswer
    : safeOptions[0]?.id || ''

  return {
    ...question,
    options: safeOptions,
    mediaUrl: question.mediaType === 'none' ? '' : question.mediaUrl,
    points: safePoints,
    penaltyPoints: safePenalty,
    timeLimitSeconds: safeTimer,
    correctAnswer,
    correctAnswerMediaType: safeCorrectAnswerMediaType,
    correctAnswerMediaUrl: safeCorrectAnswerMediaUrl,
    columnName: question.columnName || '',
    specialType: question.specialType || 'normal',
  }
}

export function QuizEditorPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { quizId = '' } = useParams()
  const { token, user } = useAuth()
  const [quiz, setQuiz] = useState<QuizDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [importProgress, setImportProgress] = useState<number | null>(null)
  const [mediaUploadProgress, setMediaUploadProgress] = useState<Record<number, number>>({})
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [accentInput, setAccentInput] = useState('#ff7a59')
  const [editorPinInput, setEditorPinInput] = useState('')
  const [editorPinTouched, setEditorPinTouched] = useState(false)
  const [collapsedQuestionIds, setCollapsedQuestionIds] = useState<Record<number, boolean>>({})
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const autosaveInFlightRef = useRef(false)
  const autosaveQueuedRef = useRef(false)
  const quizDraftRef = useRef<QuizDetail | null>(null)
  const quizMetaDirtyRef = useRef(false)
  const dirtyQuestionIdsRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    quizDraftRef.current = quiz
  }, [quiz])

  useEffect(() => {
    if (!token) return

    withQuizPin(
      quizId,
      (quizPin) => api.getQuiz(token, quizId, quizPin),
      t('editor.pinPrompt'),
    )
      .then((loadedQuiz) => {
        setQuiz({ ...loadedQuiz, boardLayout: sanitizeBoardLayout(loadedQuiz.boardLayout) })
        setAccentInput(loadedQuiz.accentColor)
        setEditorPinInput('')
        setEditorPinTouched(false)
        setError('')
        setSaveState('idle')
        setCollapsedQuestionIds(buildCollapsedState(loadedQuiz.questions, true))
        quizMetaDirtyRef.current = false
        dirtyQuestionIdsRef.current.clear()
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load quiz'))
  }, [quizId, t, token])

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [])

  function queueAutosave() {
    setSaveState('pending')

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null
      void flushAutosave()
    }, AUTOSAVE_DELAY_MS)
  }

  async function flushAutosave() {
    if (!token || !quizDraftRef.current) return

    if (autosaveInFlightRef.current) {
      autosaveQueuedRef.current = true
      return
    }

    if (!quizMetaDirtyRef.current && dirtyQuestionIdsRef.current.size === 0) {
      return
    }

    autosaveInFlightRef.current = true
    setSaveState('saving')

    const currentQuiz = quizDraftRef.current
    const saveMeta = quizMetaDirtyRef.current
    const dirtyQuestionIds = Array.from(dirtyQuestionIdsRef.current)

    quizMetaDirtyRef.current = false
    dirtyQuestionIdsRef.current.clear()

    let hasFailed = false

    if (saveMeta) {
      try {
        const currentQuizPin = getStoredQuizPin(currentQuiz.id) || undefined
        await api.updateQuiz(token, currentQuiz.id, {
          title: currentQuiz.title,
          description: currentQuiz.description,
          mode: currentQuiz.mode,
          accentColor: currentQuiz.accentColor,
          isPublished: currentQuiz.isPublished,
          boardLayout: currentQuiz.boardLayout,
          ...(editorPinTouched ? { editorPin: editorPinInput } : {}),
        }, currentQuizPin)
        if (editorPinTouched) {
          setStoredQuizPin(currentQuiz.id, editorPinInput || '')
          setEditorPinTouched(false)
        }
      } catch (saveError) {
        hasFailed = true
        quizMetaDirtyRef.current = true
        setError(saveError instanceof Error ? saveError.message : 'Could not save quiz')
      }
    }

    for (const questionId of dirtyQuestionIds) {
      const latestQuestion = quizDraftRef.current?.questions.find((entry) => entry.id === questionId)
      if (!latestQuestion) continue

      try {
        await api.updateQuestion(
          token,
          currentQuiz.id,
          questionId,
          sanitizeQuestion(latestQuestion),
          getStoredQuizPin(currentQuiz.id) || undefined,
        )
      } catch (saveError) {
        hasFailed = true
        dirtyQuestionIdsRef.current.add(questionId)
        setError(saveError instanceof Error ? saveError.message : 'Could not save question')
      }
    }

    autosaveInFlightRef.current = false

    if (hasFailed) {
      setSaveState('error')
    } else {
      setError('')
    }

    if (quizMetaDirtyRef.current || dirtyQuestionIdsRef.current.size > 0 || autosaveQueuedRef.current) {
      autosaveQueuedRef.current = false
      queueAutosave()
      return
    }

    setSaveState(hasFailed ? 'error' : 'saved')
  }

  function patchQuiz(updater: (current: QuizDetail) => QuizDetail) {
    setQuiz((current) => {
      if (!current) return current
      const nextQuiz = updater(current)
      quizMetaDirtyRef.current = true
      setAccentInput(nextQuiz.accentColor)
      queueAutosave()
      return nextQuiz
    })
  }

  function patchQuestion(questionId: number, updater: (question: Question) => Question) {
    setQuiz((current) => {
      if (!current) return current

      const nextQuiz = {
        ...current,
        questions: current.questions.map((question) => (question.id === questionId ? updater(question) : question)),
      }

      dirtyQuestionIdsRef.current.add(questionId)
      queueAutosave()
      return nextQuiz
    })
  }

  function patchBoardLayout(updater: (layout: QuizBoardRound[]) => QuizBoardRound[]) {
    patchQuiz((current) => ({ ...current, boardLayout: sanitizeBoardLayout(updater(current.boardLayout || [])) }))
  }

  function toggleQuestionCollapsed(questionId: number) {
    setCollapsedQuestionIds((current) => ({
      ...current,
      [questionId]: !current[questionId],
    }))
  }

  function setAllQuestionsCollapsed(collapsed: boolean) {
    setCollapsedQuestionIds(buildCollapsedState(quizDraftRef.current?.questions, collapsed))
  }

  function setQuestionType(questionId: number, nextType: QuestionType) {
    if (quizDraftRef.current?.mode === 'buzz') {
      patchQuestion(questionId, (question) => ({
        ...question,
        type: 'text',
        options: [],
      }))
      return
    }

    patchQuestion(questionId, (question) => {
      if (nextType === 'text') {
        return {
          ...question,
          type: 'text',
          options: [],
          correctAnswer: '',
        }
      }

      const nextOptions = question.options.length > 0 ? question.options : createDefaultOptions(4)
      return {
        ...question,
        type: 'multiple_choice',
        options: nextOptions,
        correctAnswer: nextOptions.some((option) => option.id === question.correctAnswer)
          ? question.correctAnswer
          : nextOptions[0]?.id || '',
      }
    })
  }

  function updateOption(questionId: number, optionId: string, text: string) {
    patchQuestion(questionId, (question) => ({
      ...question,
      options: question.options.map((option) => (option.id === optionId ? { ...option, text } : option)),
    }))
  }

  function addOption(questionId: number) {
    patchQuestion(questionId, (question) => {
      const nextOption = { id: getNextOptionId(question.options), text: '' }
      const nextOptions = [...question.options, nextOption]

      return {
        ...question,
        options: nextOptions,
        correctAnswer: question.correctAnswer || nextOption.id,
      }
    })
  }

  function moveQuestion(questionId: number, direction: -1 | 1) {
    if (!quiz) return
    const layout = sanitizeBoardLayout(quiz.boardLayout)
    const roundIdx = Object.fromEntries(layout.map((r, i) => [r.name, i]))

    const sorted = [...questions].sort((a, b) => {
      const ra = a.roundName ? (roundIdx[a.roundName] ?? layout.length) : layout.length
      const rb = b.roundName ? (roundIdx[b.roundName] ?? layout.length) : layout.length
      if (ra !== rb) return ra - rb
      return a.order - b.order
    })

    const index = sorted.findIndex((q) => q.id === questionId)
    const nextIndex = index + direction

    if (index < 0 || nextIndex < 0 || nextIndex >= sorted.length) return
    if (sorted[index].roundName !== sorted[nextIndex].roundName) return

    // Swap in the sorted array then reassign order=0,1,2,... across all questions
    // so the backend's plain `order` sort always reflects the round-aware sequence.
    const reordered = [...sorted]
    ;[reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]]

    setQuiz((current) => {
      if (!current) return current
      const orderMap = Object.fromEntries(reordered.map((q, i) => [q.id, i]))
      const nextQuestions = current.questions.map((q) =>
        orderMap[q.id] !== undefined ? { ...q, order: orderMap[q.id] } : q,
      )
      nextQuestions.forEach((q) => dirtyQuestionIdsRef.current.add(q.id))
      queueAutosave()
      return { ...current, questions: nextQuestions }
    })
  }

  function moveOption(questionId: number, optionId: string, direction: -1 | 1) {
    patchQuestion(questionId, (question) => {
      const index = question.options.findIndex((option) => option.id === optionId)
      const nextIndex = index + direction

      if (index < 0 || nextIndex < 0 || nextIndex >= question.options.length) {
        return question
      }

      const nextOptions = [...question.options]
      const [movedOption] = nextOptions.splice(index, 1)
      nextOptions.splice(nextIndex, 0, movedOption)

      return {
        ...question,
        options: nextOptions,
      }
    })
  }

  function deleteOption(questionId: number, optionId: string) {
    patchQuestion(questionId, (question) => {
      const nextOptions = question.options.filter((option) => option.id !== optionId)
      const nextCorrectAnswer = question.correctAnswer === optionId ? nextOptions[0]?.id || '' : question.correctAnswer

      return {
        ...question,
        options: nextOptions,
        correctAnswer: nextCorrectAnswer,
      }
    })
  }

  function setMediaType(questionId: number, nextType: MediaType) {
    patchQuestion(questionId, (question) => ({
      ...question,
      mediaType: nextType,
      mediaUrl: nextType === 'none' ? '' : question.mediaUrl,
    }))
  }

  function updateScoreValue(questionId: number, field: 'points' | 'penaltyPoints', value: string) {
    const numericValue = Number(value)

    patchQuestion(questionId, (question) => ({
      ...question,
      [field]: Number.isFinite(numericValue) ? numericValue : 0,
    }))
  }

  function confirmDeleteQuiz() {
    return window.confirm(`${t('editor.delete')}?`)
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    window.URL.revokeObjectURL(url)
  }

  function getSaveLabel() {
    switch (saveState) {
      case 'pending':
        return t('editor.autosavePending')
      case 'saving':
        return t('editor.autosaving')
      case 'saved':
        return t('editor.autosaved')
      case 'error':
        return t('editor.autosaveFailed')
      default:
        return t('editor.autosaveReady')
    }
  }

  if (!user || !token) {
    return (
      <section className="panel">
        <p>{t('editor.authRequired')}</p>
      </section>
    )
  }

  if (!quiz) {
    return <section className="panel">{error || t('common.loading')}</section>
  }

  const questions = Array.isArray(quiz.questions) ? quiz.questions : []
  const boardLayout = sanitizeBoardLayout(quiz.boardLayout)
  const roundIndexMap = Object.fromEntries(boardLayout.map((r, i) => [r.name, i]))
  const sortedQuestions = [...questions].sort((a, b) => {
    const ra = a.roundName ? (roundIndexMap[a.roundName] ?? boardLayout.length) : boardLayout.length
    const rb = b.roundName ? (roundIndexMap[b.roundName] ?? boardLayout.length) : boardLayout.length
    if (ra !== rb) return ra - rb
    return a.order - b.order
  })

  return (
    <section className="panel editor-page">
      <div className="inline-header">
        <div>
          <span className="eyebrow">{t('editor.badge')}</span>
          <h1>{quiz.title}</h1>
        </div>
        <div className="action-row">
          <button
            className="ghost-button danger-button"
            disabled={busy}
            onClick={async () => {
              if (!confirmDeleteQuiz()) return

              setBusy(true)
              setError('')
              try {
                await flushAutosave()
                await api.deleteQuiz(token, quiz.id, getStoredQuizPin(quiz.id) || undefined)
                navigate('/admin')
              } catch (deleteError) {
                setError(deleteError instanceof Error ? deleteError.message : 'Could not delete quiz')
              } finally {
                setBusy(false)
              }
            }}
            type="button"
          >
            {t('editor.delete')}
          </button>
          <button
            className="ghost-button"
            onClick={async () => {
              await flushAutosave()
              navigate('/admin')
            }}
            type="button"
          >
            {t('editor.back')}
          </button>
        </div>
      </div>

      <div className="helper-banner autosave-banner">
        <div>
          <strong>{t('editor.quizSettings')}</strong>
          <span>{t('editor.autosaveHint')}</span>
        </div>
        <div className="save-chip-shell">
          <span className={`save-chip save-${saveState}`}>{getSaveLabel()}</span>
        </div>
      </div>

      <div className="editor-meta editor-meta-rich">
        <label>
          <span>{t('editor.quizTitle')}</span>
          <input
            onChange={(event) => patchQuiz((current) => ({ ...current, title: event.target.value }))}
            placeholder={t('editor.quizTitle')}
            value={quiz.title}
          />
        </label>

        <label className="editor-span-2">
          <span>{t('editor.description')}</span>
          <textarea
            onChange={(event) => patchQuiz((current) => ({ ...current, description: event.target.value }))}
            rows={3}
            value={quiz.description}
          />
        </label>

        <label>
          <span>{t('editor.pinLabel')}</span>
          <input
            onChange={(event) => {
              setEditorPinInput(event.target.value)
              setEditorPinTouched(true)
              quizMetaDirtyRef.current = true
              queueAutosave()
            }}
            placeholder={t('editor.pinPlaceholder')}
            type="password"
            value={editorPinInput}
          />
        </label>

        <span className="helper-text">{t('editor.pinHint')}</span>

        <div className="selection-field">
          <span>{t('editor.mode')}</span>
          <div className="selection-grid compact-selection-grid">
            <button
              className={`selection-card ${quiz.mode === 'classic' ? 'active' : ''}`}
              onClick={() => patchQuiz((current) => ({ ...current, mode: 'classic' }))}
              type="button"
            >
              <strong>{t('admin.modeClassic')}</strong>
              <span>{t('editor.classicModeHint')}</span>
            </button>
            <button
              className={`selection-card ${quiz.mode === 'buzz' ? 'active' : ''}`}
              onClick={() => patchQuiz((current) => ({
                ...current,
                mode: 'buzz',
                boardLayout: current.boardLayout.length > 0 ? current.boardLayout : [createBoardRound(0)],
                questions: current.questions.map((question) => ({
                  ...question,
                  type: 'text',
                  options: [],
                })),
              }))}
              type="button"
            >
              <strong>{t('admin.modeBuzz')}</strong>
              <span>{t('editor.buzzModeHint')}</span>
            </button>
          </div>
        </div>

        <div className="selection-field accent-field">
          <span>{t('editor.accent')}</span>
          <div className="accent-picker">
            <div className="accent-swatch-row">
              {ACCENT_PRESETS.map((color) => (
                <button
                  aria-label={`${t('editor.accent')} ${color}`}
                  className={`accent-swatch ${quiz.accentColor.toLowerCase() === color.toLowerCase() ? 'active' : ''}`}
                  key={color}
                  onClick={() => patchQuiz((current) => ({ ...current, accentColor: color }))}
                  style={{ background: color }}
                  type="button"
                />
              ))}
            </div>

            <div className="accent-custom-row">
              <input
                aria-label={t('editor.accent')}
                onChange={(event) => {
                  setAccentInput(event.target.value)
                  patchQuiz((current) => ({ ...current, accentColor: event.target.value }))
                }}
                type="color"
                value={quiz.accentColor}
              />
              <input
                onBlur={() => setAccentInput(quiz.accentColor)}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setAccentInput(nextValue)

                  if (/^#[0-9a-fA-F]{6}$/.test(nextValue)) {
                    patchQuiz((current) => ({ ...current, accentColor: nextValue }))
                  }
                }}
                value={accentInput}
              />
              <div className="accent-preview" style={{ '--accent-preview': quiz.accentColor } as CSSProperties}>
                <strong>{t('editor.accentPreview')}</strong>
                <span>{quiz.accentColor}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {quiz.mode === 'buzz' ? (
        <section className="question-editor-card board-layout-card">
          <div className="inline-header">
            <div>
              <strong>{t('editor.boardBuilderTitle')}</strong>
              <span>{t('editor.boardBuilderHint')}</span>
            </div>
            <button
              className="ghost-button"
              onClick={() => patchBoardLayout((current) => [...current, createBoardRound(current.length)])}
              type="button"
            >
              {t('editor.addRound')}
            </button>
          </div>

          <div className="round-planner">
            {boardLayout.map((round, roundIndex) => (
              <article className="round-card" key={round.id}>
                <div className="inline-header">
                  <label className="round-name-field">
                    <span>{t('editor.roundName')}</span>
                    <input
                      onChange={(event) => {
                        const nextName = event.target.value
                        patchQuiz((current) => ({
                          ...current,
                          boardLayout: current.boardLayout.map((entry) => (entry.id === round.id ? { ...entry, name: nextName } : entry)),
                          questions: current.questions.map((question) =>
                            question.roundName === round.name ? { ...question, roundName: nextName } : question,
                          ),
                        }))
                      }}
                      value={round.name}
                    />
                  </label>
                  <div className="action-row">
                    <button
                      className="ghost-button"
                      disabled={roundIndex === 0}
                      onClick={() => patchBoardLayout((current) => {
                        const next = [...current]
                        const [item] = next.splice(roundIndex, 1)
                        next.splice(roundIndex - 1, 0, item)
                        return next
                      })}
                      type="button"
                    >
                      {t('editor.moveUp')}
                    </button>
                    <button
                      className="ghost-button"
                      disabled={roundIndex === boardLayout.length - 1}
                      onClick={() => patchBoardLayout((current) => {
                        const next = [...current]
                        const [item] = next.splice(roundIndex, 1)
                        next.splice(roundIndex + 1, 0, item)
                        return next
                      })}
                      type="button"
                    >
                      {t('editor.moveDown')}
                    </button>
                    <button
                      className="ghost-button danger-button"
                      onClick={() => {
                        patchQuiz((current) => ({
                          ...current,
                          boardLayout: current.boardLayout.filter((entry) => entry.id !== round.id),
                          questions: current.questions.map((question) =>
                            question.roundName === round.name
                              ? { ...question, roundName: '', columnName: '' }
                              : question,
                          ),
                        }))
                      }}
                      type="button"
                    >
                      {t('editor.delete')}
                    </button>
                  </div>
                </div>

                <div className="column-planner">
                  {round.columns.map((column, columnIndex) => (
                    <div className="column-chip-editor" key={column.id}>
                      <input
                        onChange={(event) => {
                          const nextName = event.target.value
                          patchQuiz((current) => ({
                            ...current,
                            boardLayout: current.boardLayout.map((entry) =>
                              entry.id === round.id
                                ? {
                                    ...entry,
                                    columns: entry.columns.map((candidate) =>
                                      candidate.id === column.id ? { ...candidate, name: nextName } : candidate,
                                    ),
                                  }
                                : entry,
                            ),
                            questions: current.questions.map((question) =>
                              question.roundName === round.name && question.columnName === column.name
                                ? { ...question, columnName: nextName }
                                : question,
                            ),
                          }))
                        }}
                        placeholder={t('editor.columnName')}
                        value={column.name}
                      />
                      <div className="action-row">
                        <button
                          className="ghost-button option-action"
                          disabled={columnIndex === 0}
                          onClick={() => patchBoardLayout((current) =>
                            current.map((entry) => {
                              if (entry.id !== round.id) return entry
                              const nextColumns = [...entry.columns]
                              const [item] = nextColumns.splice(columnIndex, 1)
                              nextColumns.splice(columnIndex - 1, 0, item)
                              return { ...entry, columns: nextColumns }
                            }),
                          )}
                          type="button"
                        >
                          {t('editor.moveUp')}
                        </button>
                        <button
                          className="ghost-button option-action"
                          disabled={columnIndex === round.columns.length - 1}
                          onClick={() => patchBoardLayout((current) =>
                            current.map((entry) => {
                              if (entry.id !== round.id) return entry
                              const nextColumns = [...entry.columns]
                              const [item] = nextColumns.splice(columnIndex, 1)
                              nextColumns.splice(columnIndex + 1, 0, item)
                              return { ...entry, columns: nextColumns }
                            }),
                          )}
                          type="button"
                        >
                          {t('editor.moveDown')}
                        </button>
                        <button
                          className="ghost-button option-action danger-button"
                          onClick={() => {
                            patchQuiz((current) => ({
                              ...current,
                              boardLayout: current.boardLayout.map((entry) =>
                                entry.id === round.id
                                  ? { ...entry, columns: entry.columns.filter((candidate) => candidate.id !== column.id) }
                                  : entry,
                              ),
                              questions: current.questions.map((question) =>
                                question.roundName === round.name && question.columnName === column.name
                                  ? { ...question, columnName: '' }
                                  : question,
                              ),
                            }))
                          }}
                          type="button"
                        >
                          {t('editor.removeOption')}
                        </button>
                      </div>
                      {boardLayout.length > 1 && (
                        <select
                          className="inline-select"
                          onChange={(event) => {
                            const targetRoundId = event.target.value
                            if (!targetRoundId) return
                            patchQuiz((current) => {
                              const targetRound = current.boardLayout.find((r) => r.id === targetRoundId)
                              if (!targetRound) return current
                              return {
                                ...current,
                                boardLayout: current.boardLayout.map((entry) => {
                                  if (entry.id === round.id) {
                                    return { ...entry, columns: entry.columns.filter((c) => c.id !== column.id) }
                                  }
                                  if (entry.id === targetRoundId) {
                                    return { ...entry, columns: [...entry.columns, column] }
                                  }
                                  return entry
                                }),
                                questions: current.questions.map((question) =>
                                  question.roundName === round.name && question.columnName === column.name
                                    ? { ...question, roundName: targetRound.name }
                                    : question,
                                ),
                              }
                            })
                          }}
                          value=""
                        >
                          <option value="">{t('editor.moveColumnToRound')}</option>
                          {boardLayout
                            .filter((r) => r.id !== round.id)
                            .map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  className="ghost-button"
                  onClick={() => patchBoardLayout((current) =>
                    current.map((entry) =>
                      entry.id === round.id
                        ? { ...entry, columns: [...entry.columns, createBoardColumn(`Column ${entry.columns.length + 1}`)] }
                        : entry,
                    ),
                  )}
                  type="button"
                >
                  {t('editor.addColumn')}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="action-row">
        <input
          accept=".zip,application/zip"
          className="visually-hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return

            const uploadSizeError = getUploadSizeError(file)
            if (uploadSizeError) {
              setError(uploadSizeError)
              event.currentTarget.value = ''
              return
            }

            setBusy(true)
            setError('')
            setImportProgress(0)
            try {
              const importedQuiz = await api.importQuiz(token, file, setImportProgress)
              navigate(`/admin/quizzes/${importedQuiz.id}`)
            } catch (importError) {
              setError(importError instanceof Error ? importError.message : 'Could not import quiz')
            } finally {
              event.currentTarget.value = ''
              setImportProgress(null)
              setBusy(false)
            }
          }}
          ref={importInputRef}
          type="file"
        />
        <button
          className="ghost-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              const exported = await api.exportQuiz(token, quiz.id, getStoredQuizPin(quiz.id) || undefined)
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
        <button className="ghost-button" disabled={busy} onClick={() => importInputRef.current?.click()} type="button">
          {t('editor.importQuiz')}
        </button>
      </div>

      {importProgress !== null ? (
        <div className="upload-progress" role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={importProgress}>
          <div className="upload-progress-fill" style={{ width: `${importProgress}%` }} />
          <span>{importProgress}%</span>
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      <div className="action-row">
        <button
          className="ghost-button"
          onClick={() => setAllQuestionsCollapsed(true)}
          type="button"
        >
          {t('editor.collapseAllQuestions')}
        </button>
        <button
          className="ghost-button"
          onClick={() => setAllQuestionsCollapsed(false)}
          type="button"
        >
          {t('editor.expandAllQuestions')}
        </button>
      </div>

      <div className="question-stack">
        {sortedQuestions.map((question, index) => {
          const isBuzzQuiz = quiz.mode === 'buzz'
          const isMultipleChoice = !isBuzzQuiz && question.type === 'multiple_choice'
          const hasMedia = question.mediaType !== 'none'
          const isCollapsed = Boolean(collapsedQuestionIds[question.id])
          const selectedRound = boardLayout.find((round) => round.name === question.roundName) ?? null
          const availableColumns = selectedRound?.columns ?? []
          const canMoveUp = index > 0 && sortedQuestions[index - 1].roundName === question.roundName
          const canMoveDown = index < sortedQuestions.length - 1 && sortedQuestions[index + 1].roundName === question.roundName

          return (
            <article className="question-editor-card question-editor-flow" key={question.id}>
              <div className="inline-header">
                <div>
                  <span className="question-kicker">
                    {t('editor.question')} {index + 1}
                  </span>
                  <h2>{question.prompt || t('editor.questionUntitled')}</h2>
                </div>
                <button
                  className="ghost-button"
                  disabled={!canMoveUp}
                  onClick={() => moveQuestion(question.id, -1)}
                  type="button"
                >
                  {t('editor.moveUp')}
                </button>
                <button
                  className="ghost-button"
                  disabled={!canMoveDown}
                  onClick={() => moveQuestion(question.id, 1)}
                  type="button"
                >
                  {t('editor.moveDown')}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => toggleQuestionCollapsed(question.id)}
                  type="button"
                >
                  {isCollapsed ? t('editor.expandQuestion') : t('editor.collapseQuestion')}
                </button>
                <button
                  className="ghost-button"
                  onClick={async () => {
                    dirtyQuestionIdsRef.current.delete(question.id)
                    setBusy(true)
                    setError('')
                    try {
                      await flushAutosave()
                      await api.deleteQuestion(token, quiz.id, question.id, getStoredQuizPin(quiz.id) || undefined)
                      const updatedQuiz = await api.getQuiz(token, quizId, getStoredQuizPin(quiz.id) || undefined)
                      setQuiz({ ...updatedQuiz, boardLayout: sanitizeBoardLayout(updatedQuiz.boardLayout) })
                      setCollapsedQuestionIds(buildCollapsedState(updatedQuiz.questions, true))
                    } catch (deleteError) {
                      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete question')
                    } finally {
                      setBusy(false)
                    }
                  }}
                  type="button"
                >
                  {t('editor.delete')}
                </button>
              </div>

              {isCollapsed ? null : (
                <>

              <div className="question-flow-step">
                <div className="step-number">1</div>
                <div className="step-body">
                  <strong>{t('editor.prompt')}</strong>
                  <span>{t('editor.promptHint')}</span>
                  <textarea
                    onChange={(event) => patchQuestion(question.id, (current) => ({ ...current, prompt: event.target.value }))}
                    placeholder={t('editor.promptPlaceholder')}
                    rows={3}
                    value={question.prompt}
                  />
                </div>
              </div>

              <div className="question-flow-step">
                <div className="step-number">2</div>
                <div className="step-body">
                  <strong>{t('editor.helpText')}</strong>
                  <span>{t('editor.helpHint')}</span>
                  <textarea
                    onChange={(event) => patchQuestion(question.id, (current) => ({ ...current, helpText: event.target.value }))}
                    placeholder={t('editor.helpPlaceholder')}
                    rows={2}
                    value={question.helpText}
                  />
                </div>
              </div>

              <div className="question-flow-step">
                <div className="step-number">3</div>
                <div className="step-body">
                  <strong>{t('editor.answerFormat')}</strong>
                  {isBuzzQuiz ? (
                    <div className="helper-banner">
                      <strong>{t('editor.textInput')}</strong>
                      <span>{t('editor.buzzAnswerLocked')}</span>
                    </div>
                  ) : (
                    <>
                      <span>{t('editor.typeHint')}</span>
                      <div className="selection-grid">
                        <button
                          className={`selection-card ${isMultipleChoice ? 'active' : ''}`}
                          onClick={() => setQuestionType(question.id, 'multiple_choice')}
                          type="button"
                        >
                          <strong>{t('editor.multipleChoice')}</strong>
                          <span>{t('editor.multipleChoiceHint')}</span>
                        </button>
                        <button
                          className={`selection-card ${question.type === 'text' ? 'active' : ''}`}
                          onClick={() => setQuestionType(question.id, 'text')}
                          type="button"
                        >
                          <strong>{t('editor.textInput')}</strong>
                          <span>{t('editor.textInputHint')}</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {isMultipleChoice ? (
                <div className="question-flow-step">
                  <div className="step-number">4</div>
                  <div className="step-body">
                    <div className="inline-header step-header">
                      <div>
                        <strong>{t('editor.answerOptions')}</strong>
                        <span>{t('editor.optionsHint')}</span>
                      </div>
                      <button className="ghost-button" onClick={() => addOption(question.id)} type="button">
                        {t('editor.addOption')}
                      </button>
                    </div>

                    <div className="option-constructor">
                      {question.options.map((option, optionIndex) => (
                        <div className="option-constructor-row" key={option.id}>
                          <button
                            className={`correct-option-toggle ${question.correctAnswer === option.id ? 'active' : ''}`}
                            onClick={() => patchQuestion(question.id, (current) => ({ ...current, correctAnswer: option.id }))}
                            type="button"
                          >
                            <span>{option.id}</span>
                            <strong>{t('editor.markCorrect')}</strong>
                          </button>

                          <input
                            onChange={(event) => updateOption(question.id, option.id, event.target.value)}
                            placeholder={`${t('editor.optionLabel')} ${option.id}`}
                            value={option.text}
                          />

                          <div className="option-row-actions">
                            <button
                              className="ghost-button option-action"
                              disabled={optionIndex === 0}
                              onClick={() => moveOption(question.id, option.id, -1)}
                              type="button"
                            >
                              {t('editor.moveUp')}
                            </button>
                            <button
                              className="ghost-button option-action"
                              disabled={optionIndex === question.options.length - 1}
                              onClick={() => moveOption(question.id, option.id, 1)}
                              type="button"
                            >
                              {t('editor.moveDown')}
                            </button>
                            <button
                              className="ghost-button option-action danger-button"
                              onClick={() => deleteOption(question.id, option.id)}
                              type="button"
                            >
                              {t('editor.removeOption')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="question-flow-step">
                  <div className="step-number">4</div>
                  <div className="step-body">
                    <strong>{t('editor.correctAnswer')}</strong>
                    <span>{t('editor.textAnswerHint')}</span>
                    <input
                      onChange={(event) => patchQuestion(question.id, (current) => ({ ...current, correctAnswer: event.target.value }))}
                      placeholder={t('editor.correctAnswer')}
                      value={question.correctAnswer || ''}
                    />
                  </div>
                </div>
              )}

              <div className="question-flow-step">
                <div className="step-number">5</div>
                <div className="step-body">
                  <strong>{t('editor.scoring')}</strong>
                  <span>{t('editor.scoringHint')}</span>
                  <div className="score-grid">
                    <label>
                      <span>{t('editor.points')}</span>
                      <input
                        min={0}
                        onChange={(event) => updateScoreValue(question.id, 'points', event.target.value)}
                        type="number"
                        value={question.points}
                      />
                    </label>
                    <label>
                      <span>{t('editor.penalty')}</span>
                      <input
                        min={0}
                        onChange={(event) => updateScoreValue(question.id, 'penaltyPoints', event.target.value)}
                        type="number"
                        value={question.penaltyPoints}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="question-flow-step">
                <div className="step-number">6</div>
                <div className="step-body">
                  <strong>{t('editor.columnName')}</strong>
                  <span>{isBuzzQuiz ? t('editor.boardAssignHint') : t('editor.buzzModeHint')}</span>
                  <div className="score-grid">
                    {isBuzzQuiz ? (
                      <>
                        <label>
                          <span>{t('editor.roundName')}</span>
                          <select
                            onChange={(event) =>
                              patchQuestion(question.id, (current) => ({
                                ...current,
                                roundName: event.target.value,
                                columnName: '',
                              }))
                            }
                            value={question.roundName}
                          >
                            <option value="">{t('editor.unassignedRound')}</option>
                            {boardLayout.map((round) => (
                              <option key={round.id} value={round.name}>{round.name}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>{t('editor.columnName')}</span>
                          <select
                            disabled={!selectedRound}
                            onChange={(event) => patchQuestion(question.id, (current) => ({ ...current, columnName: event.target.value }))}
                            value={question.columnName}
                          >
                            <option value="">{t('editor.unassignedColumn')}</option>
                            {availableColumns.map((column) => (
                              <option key={column.id} value={column.name}>{column.name}</option>
                            ))}
                          </select>
                        </label>
                      </>
                    ) : (
                      <label>
                        <span>{t('editor.columnName')}</span>
                        <input
                          onChange={(event) => patchQuestion(question.id, (current) => ({ ...current, columnName: event.target.value }))}
                          placeholder={t('editor.columnNamePlaceholder')}
                          value={question.columnName}
                        />
                      </label>
                    )}
                    <label>
                      <span>{t('editor.specialType')}</span>
                      <select
                        onChange={(event) =>
                          patchQuestion(question.id, (current) => ({ ...current, specialType: event.target.value as Question['specialType'] }))
                        }
                        value={question.specialType}
                      >
                        <option value="normal">{t('editor.specialTypeNormal')}</option>
                        <option value="cat_in_bag">{t('editor.specialTypeCatInBag')}</option>
                        <option value="stakes">{t('editor.specialTypeStakes')}</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>

              <div className="question-flow-step">
                <div className="step-number">7</div>
                <div className="step-body">
                  <strong>{t('editor.correctAnswerMedia')}</strong>
                  <span>{t('editor.correctAnswer')}</span>
                  <div className="score-grid">
                    <label>
                      <span>{t('editor.correctAnswerMediaType')}</span>
                      <select
                        onChange={(event) =>
                          patchQuestion(question.id, (current) => ({
                            ...current,
                            correctAnswerMediaType: event.target.value as MediaType,
                            correctAnswerMediaUrl: event.target.value === 'none' ? '' : (current.correctAnswerMediaUrl ?? ''),
                          }))
                        }
                        value={question.correctAnswerMediaType ?? 'none'}
                      >
                        {(['none', 'image', 'audio', 'video'] as MediaType[]).map((mediaType) => (
                          <option key={mediaType} value={mediaType}>
                            {t(`editor.${mediaType}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t('editor.correctAnswerMediaUrl')}</span>
                      <input
                        disabled={(question.correctAnswerMediaType ?? 'none') === 'none'}
                        onChange={(event) => patchQuestion(question.id, (current) => ({ ...current, correctAnswerMediaUrl: event.target.value }))}
                        placeholder={t('editor.correctAnswerMediaUrl')}
                        value={question.correctAnswerMediaUrl ?? ''}
                      />
                    </label>
                  </div>

                  {(question.correctAnswerMediaType ?? 'none') !== 'none' ? (
                    <div className="media-editor-block">
                      <label className="file-trigger media-upload-trigger">
                        <span>{t('editor.uploadMedia')}</span>
                        <input
                          accept="image/*,audio/*,video/*"
                          onChange={async (event) => {
                            const file = event.target.files?.[0]
                            if (!file) return

                            const uploadSizeError = getUploadSizeError(file)
                            if (uploadSizeError) {
                              setError(uploadSizeError)
                              event.currentTarget.value = ''
                              return
                            }

                            setError('')
                            setMediaUploadProgress((current) => ({ ...current, [-question.id]: 0 }))

                            try {
                              const upload = await api.uploadQuizMedia(
                                token,
                                quiz.id,
                                file,
                                (progress) => setMediaUploadProgress((current) => ({ ...current, [-question.id]: progress })),
                                getStoredQuizPin(quiz.id) || undefined,
                              )

                              patchQuestion(question.id, (current) => ({ ...current, correctAnswerMediaUrl: upload.url }))
                            } catch (uploadError) {
                              setError(uploadError instanceof Error ? uploadError.message : 'Media upload failed')
                            } finally {
                              setMediaUploadProgress((current) => {
                                const next = { ...current }
                                delete next[-question.id]
                                return next
                              })
                              event.currentTarget.value = ''
                            }
                          }}
                          type="file"
                        />
                      </label>

                      {typeof mediaUploadProgress[-question.id] === 'number' ? (
                        <div
                          className="upload-progress"
                          role="progressbar"
                          aria-valuemax={100}
                          aria-valuemin={0}
                          aria-valuenow={mediaUploadProgress[-question.id]}
                        >
                          <div className="upload-progress-fill" style={{ width: `${mediaUploadProgress[-question.id]}%` }} />
                          <span>{mediaUploadProgress[-question.id]}%</span>
                        </div>
                      ) : null}

                      {question.correctAnswerMediaUrl ? (
                        <div className="media-preview-panel">
                          <strong>{t('editor.mediaPreview')}</strong>
                          {question.correctAnswerMediaType === 'image' ? (
                            <img alt="Answer media" className="media-visual" src={question.correctAnswerMediaUrl} />
                          ) : null}
                          {question.correctAnswerMediaType === 'video' ? (
                            <video className="media-visual" controls src={question.correctAnswerMediaUrl} />
                          ) : null}
                          {question.correctAnswerMediaType === 'audio' ? (
                            <audio controls src={question.correctAnswerMediaUrl} style={{ width: '100%' }} />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="question-flow-step">
                <div className="step-number">8</div>
                <div className="step-body">
                  <strong>{t('editor.media')}</strong>
                  <span>{t('editor.mediaHint')}</span>
                  <div className="selection-grid">
                    {(['none', 'image', 'audio', 'video'] as MediaType[]).map((mediaType) => (
                      <button
                        className={`selection-card compact ${question.mediaType === mediaType ? 'active' : ''}`}
                        key={mediaType}
                        onClick={() => setMediaType(question.id, mediaType)}
                        type="button"
                      >
                        <strong>{t(`editor.${mediaType}`)}</strong>
                        <span>{t(`editor.media${mediaType.charAt(0).toUpperCase()}${mediaType.slice(1)}Hint`)}</span>
                      </button>
                    ))}
                  </div>

                  {hasMedia ? (
                    <div className="media-editor-block">
                      <label>
                        <span>{t('editor.directLink')}</span>
                        <input
                          onChange={(event) => patchQuestion(question.id, (current) => ({ ...current, mediaUrl: event.target.value }))}
                          placeholder={t('editor.mediaUrl')}
                          value={question.mediaUrl}
                        />
                      </label>

                      <label className="file-trigger media-upload-trigger">
                        <span>{t('editor.uploadMedia')}</span>
                        <input
                          accept="image/*,audio/*,video/*"
                          onChange={async (event) => {
                            const file = event.target.files?.[0]
                            if (!file) return

                            const uploadSizeError = getUploadSizeError(file)
                            if (uploadSizeError) {
                              setError(uploadSizeError)
                              event.currentTarget.value = ''
                              return
                            }

                            setError('')
                            setMediaUploadProgress((current) => ({ ...current, [question.id]: 0 }))

                            try {
                              const upload = await api.uploadQuizMedia(token, quiz.id, file, (progress) => {
                                setMediaUploadProgress((current) => ({ ...current, [question.id]: progress }))
                              }, getStoredQuizPin(quiz.id) || undefined)

                              patchQuestion(question.id, (current) => ({ ...current, mediaUrl: upload.url }))
                            } catch (uploadError) {
                              setError(uploadError instanceof Error ? uploadError.message : 'Media upload failed')
                            } finally {
                              setMediaUploadProgress((current) => {
                                const next = { ...current }
                                delete next[question.id]
                                return next
                              })
                              event.currentTarget.value = ''
                            }
                          }}
                          type="file"
                        />
                      </label>

                      <span className="helper-text">
                        {t('editor.mediaSourceHint')} {MAX_UPLOAD_SIZE_MB} MB
                      </span>

                      {typeof mediaUploadProgress[question.id] === 'number' ? (
                        <div
                          className="upload-progress"
                          role="progressbar"
                          aria-valuemax={100}
                          aria-valuemin={0}
                          aria-valuenow={mediaUploadProgress[question.id]}
                        >
                          <div className="upload-progress-fill" style={{ width: `${mediaUploadProgress[question.id]}%` }} />
                          <span>{mediaUploadProgress[question.id]}%</span>
                        </div>
                      ) : null}

                      {question.mediaUrl ? (
                        <div className="media-preview-panel">
                          <strong>{t('editor.mediaPreview')}</strong>
                          <QuestionMedia question={question} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="action-row">
                <button
                  className="ghost-button"
                  onClick={() => toggleQuestionCollapsed(question.id)}
                  type="button"
                >
                  {t('editor.collapseQuestion')}
                </button>
              </div>
                </>
              )}
            </article>
          )
        })}
      </div>

      <div className="action-row">
        <button
          className="ghost-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await flushAutosave()
              await api.createQuestion(token, quiz.id, {
                order: quiz.questions.length,
                prompt: '',
                helpText: '',
                type: quiz.mode === 'buzz' ? 'text' : 'multiple_choice',
                options: quiz.mode === 'buzz' ? [] : createDefaultOptions(4),
                correctAnswer: quiz.mode === 'buzz' ? '' : 'A',
                mediaType: 'none',
                mediaUrl: '',
                timeLimitSeconds: 20,
                points: 100,
                penaltyPoints: 100,
                roundName: '',
                columnName: '',
                specialType: 'normal',
                correctAnswerMediaType: 'none',
                correctAnswerMediaUrl: '',
              }, getStoredQuizPin(quiz.id) || undefined)
              const updatedQuiz = await api.getQuiz(token, quizId, getStoredQuizPin(quiz.id) || undefined)
              setQuiz({ ...updatedQuiz, boardLayout: sanitizeBoardLayout(updatedQuiz.boardLayout) })
              const nextCollapsedState = buildCollapsedState(updatedQuiz.questions, true)
              const newestQuestion = updatedQuiz.questions[updatedQuiz.questions.length - 1]
              if (newestQuestion) {
                nextCollapsedState[newestQuestion.id] = false
              }
              setCollapsedQuestionIds(nextCollapsedState)
            } catch (createError) {
              setError(createError instanceof Error ? createError.message : 'Could not add question')
            } finally {
              setBusy(false)
            }
          }}
          type="button"
        >
          {t('editor.addQuestion')}
        </button>
      </div>
    </section>
  )
}
