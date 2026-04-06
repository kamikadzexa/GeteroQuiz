import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../context/I18nContext'
import { api } from '../services/api'
import type { MediaType, Question, QuestionOption, QuestionType, QuizDetail } from '../types'

function serializeOptions(options: QuestionOption[]) {
  return options.map((option) => `${option.id}|${option.text}`).join('\n')
}

function parseOptions(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [id, text] = line.includes('|') ? line.split('|') : [String.fromCharCode(65 + index), line]
      return { id: id.trim(), text: text.trim() }
    })
}

export function QuizEditorPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { quizId = '' } = useParams()
  const { token, user } = useAuth()
  const [quiz, setQuiz] = useState<QuizDetail | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [importProgress, setImportProgress] = useState<number | null>(null)
  const [mediaUploadProgress, setMediaUploadProgress] = useState<Record<number, number>>({})
  const importInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!token) return
    api
      .getQuiz(token, quizId)
      .then(setQuiz)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load quiz'))
  }, [quizId, token])

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
            disabled={saving}
            onClick={async () => {
              if (!confirmDeleteQuiz()) return

              setSaving(true)
              setError('')
              try {
                await api.deleteQuiz(token, quiz.id)
                navigate('/admin')
              } catch (deleteError) {
                setError(deleteError instanceof Error ? deleteError.message : 'Could not delete quiz')
              } finally {
                setSaving(false)
              }
            }}
            type="button"
          >
            {t('editor.delete')}
          </button>
          <button className="ghost-button" onClick={() => navigate('/admin')} type="button">
            {t('editor.back')}
          </button>
        </div>
      </div>

      <div className="editor-meta">
        <label>
          <span>{t('editor.quizTitle')}</span>
          <input
            onChange={(event) => setQuiz({ ...quiz, title: event.target.value })}
            value={quiz.title}
          />
        </label>
        <label>
          <span>{t('editor.description')}</span>
          <textarea
            onChange={(event) => setQuiz({ ...quiz, description: event.target.value })}
            rows={3}
            value={quiz.description}
          />
        </label>
        <label>
          <span>{t('editor.mode')}</span>
          <select
            onChange={(event) => setQuiz({ ...quiz, mode: event.target.value as QuizDetail['mode'] })}
            value={quiz.mode}
          >
            <option value="classic">{t('admin.modeClassic')}</option>
            <option value="buzz">{t('admin.modeBuzz')}</option>
          </select>
        </label>
        <label>
          <span>{t('editor.accent')}</span>
          <input
            onChange={(event) => setQuiz({ ...quiz, accentColor: event.target.value })}
            type="color"
            value={quiz.accentColor}
          />
        </label>
      </div>

      <div className="action-row">
        <input
          accept=".zip,application/zip"
          className="visually-hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return

            setSaving(true)
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
              setSaving(false)
            }
          }}
          ref={importInputRef}
          type="file"
        />
        <button
          className="cta-button"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            setError('')
            try {
              const updated = await api.updateQuiz(token, quiz.id, quiz)
              setQuiz({
                ...updated,
                questions: Array.isArray(updated.questions) ? updated.questions : questions,
              })
            } catch (saveError) {
              setError(saveError instanceof Error ? saveError.message : 'Could not save quiz')
            } finally {
              setSaving(false)
            }
          }}
          type="button"
        >
          {t('editor.saveQuiz')}
        </button>
        <button
          className="ghost-button"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            setError('')
            try {
              const exported = await api.exportQuiz(token, quiz.id)
              downloadBlob(exported.blob, exported.filename)
            } catch (exportError) {
              setError(exportError instanceof Error ? exportError.message : 'Could not export quiz')
            } finally {
              setSaving(false)
            }
          }}
          type="button"
        >
          {t('editor.exportQuiz')}
        </button>
        <button className="ghost-button" onClick={() => importInputRef.current?.click()} type="button">
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

      <div className="question-stack">
        {questions.map((question, index) => (
          <article className="question-editor-card" key={question.id}>
            <div className="inline-header">
              <h2>
                {t('editor.question')} {index + 1}
              </h2>
              <button
                className="ghost-button"
                onClick={async () => {
                  await api.deleteQuestion(token, quiz.id, question.id)
                  const updated = await api.getQuiz(token, quizId)
                  setQuiz(updated)
                }}
                type="button"
              >
                {t('editor.delete')}
              </button>
            </div>

            <div className="editor-grid">
              <label>
                <span>{t('editor.prompt')}</span>
                <textarea
                  onChange={(event) =>
                    setQuiz({
                      ...quiz,
                      questions: quiz.questions.map((item) =>
                        item.id === question.id ? { ...item, prompt: event.target.value } : item,
                      ),
                    })
                  }
                  rows={3}
                  value={question.prompt}
                />
              </label>
              <label>
                <span>{t('editor.helpText')}</span>
                <textarea
                  onChange={(event) =>
                    setQuiz({
                      ...quiz,
                      questions: quiz.questions.map((item) =>
                        item.id === question.id ? { ...item, helpText: event.target.value } : item,
                      ),
                    })
                  }
                  rows={2}
                  value={question.helpText}
                />
              </label>
              <label>
                <span>{t('editor.type')}</span>
                <select
                  onChange={(event) =>
                    setQuiz({
                      ...quiz,
                      questions: quiz.questions.map((item) =>
                        item.id === question.id
                          ? { ...item, type: event.target.value as QuestionType }
                          : item,
                      ),
                    })
                  }
                  value={question.type}
                >
                  <option value="multiple_choice">{t('editor.multipleChoice')}</option>
                  <option value="text">{t('editor.textInput')}</option>
                </select>
              </label>
              <label>
                <span>{t('editor.correctAnswer')}</span>
                <input
                  onChange={(event) =>
                    setQuiz({
                      ...quiz,
                      questions: quiz.questions.map((item) =>
                        item.id === question.id ? { ...item, correctAnswer: event.target.value } : item,
                      ),
                    })
                  }
                  value={question.correctAnswer || ''}
                />
              </label>
              <label>
                <span>{t('editor.options')}</span>
                <textarea
                  disabled={question.type !== 'multiple_choice'}
                  onChange={(event) =>
                    setQuiz({
                      ...quiz,
                      questions: quiz.questions.map((item) =>
                        item.id === question.id ? { ...item, options: parseOptions(event.target.value) } : item,
                      ),
                    })
                  }
                  rows={4}
                  value={serializeOptions(question.options)}
                />
              </label>
              <label>
                <span>{t('editor.timer')}</span>
                <input
                  min={5}
                  onChange={(event) =>
                    setQuiz({
                      ...quiz,
                      questions: quiz.questions.map((item) =>
                        item.id === question.id
                          ? { ...item, timeLimitSeconds: Number(event.target.value) }
                          : item,
                      ),
                    })
                  }
                  type="number"
                  value={question.timeLimitSeconds}
                />
              </label>
              <label>
                <span>{t('editor.points')}</span>
                <input
                  min={0}
                  onChange={(event) =>
                    setQuiz({
                      ...quiz,
                      questions: quiz.questions.map((item) =>
                        item.id === question.id ? { ...item, points: Number(event.target.value) } : item,
                      ),
                    })
                  }
                  type="number"
                  value={question.points}
                />
              </label>
              <label>
                <span>{t('editor.penalty')}</span>
                <input
                  min={0}
                  onChange={(event) =>
                    setQuiz({
                      ...quiz,
                      questions: quiz.questions.map((item) =>
                        item.id === question.id ? { ...item, penaltyPoints: Number(event.target.value) } : item,
                      ),
                    })
                  }
                  type="number"
                  value={question.penaltyPoints}
                />
              </label>
              <label>
                <span>{t('editor.mediaType')}</span>
                <select
                  onChange={(event) =>
                    setQuiz({
                      ...quiz,
                      questions: quiz.questions.map((item) =>
                        item.id === question.id
                          ? { ...item, mediaType: event.target.value as MediaType }
                          : item,
                      ),
                    })
                  }
                  value={question.mediaType}
                >
                  <option value="none">{t('editor.none')}</option>
                  <option value="image">{t('editor.image')}</option>
                  <option value="audio">{t('editor.audio')}</option>
                  <option value="video">{t('editor.video')}</option>
                </select>
              </label>
              <label>
                <span>{t('editor.mediaUrl')}</span>
                <div className="inline-upload">
                  <input
                    onChange={(event) =>
                      setQuiz({
                        ...quiz,
                        questions: quiz.questions.map((item) =>
                          item.id === question.id ? { ...item, mediaUrl: event.target.value } : item,
                        ),
                      })
                    }
                    value={question.mediaUrl}
                  />
                  <input
                    accept="image/*,audio/*,video/*"
                    onChange={async (event) => {
                      const file = event.target.files?.[0]
                      if (!file) return

                      setError('')
                      setMediaUploadProgress((current) => ({ ...current, [question.id]: 0 }))

                      try {
                        const upload = await api.uploadQuizMedia(token, quiz.id, file, (progress) => {
                          setMediaUploadProgress((current) => ({ ...current, [question.id]: progress }))
                        })

                        setQuiz({
                          ...quiz,
                          questions: quiz.questions.map((item) =>
                            item.id === question.id ? { ...item, mediaUrl: upload.url } : item,
                          ),
                        })
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
                </div>
              </label>
            </div>

            <div className="action-row">
              <button
                className="cta-button secondary"
                onClick={async () => {
                  const updatedQuestion = quiz.questions.find((item) => item.id === question.id) as Question
                  await api.updateQuestion(token, quiz.id, question.id, updatedQuestion)
                  const updated = await api.getQuiz(token, quizId)
                  setQuiz(updated)
                }}
                type="button"
              >
                {t('editor.saveQuestion')}
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="action-row">
        <button
          className="ghost-button"
          onClick={async () => {
            await api.createQuestion(token, quiz.id, {
              order: quiz.questions.length,
              prompt: 'New question',
              helpText: '',
              type: 'multiple_choice',
              options: [
                { id: 'A', text: 'Option A' },
                { id: 'B', text: 'Option B' },
                { id: 'C', text: 'Option C' },
                { id: 'D', text: 'Option D' },
              ],
              correctAnswer: 'A',
              mediaType: 'none',
              mediaUrl: '',
              timeLimitSeconds: 20,
              points: 100,
              penaltyPoints: 50,
            })
            const updated = await api.getQuiz(token, quizId)
            setQuiz(updated)
          }}
          type="button"
        >
          {t('editor.addQuestion')}
        </button>
      </div>
    </section>
  )
}
