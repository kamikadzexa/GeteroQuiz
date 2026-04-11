import { useEffect, useRef } from 'react'
import { assetUrl } from '../../services/api'
import type { Question } from '../../types'

export function QuestionMedia({ question, autoplay = true }: { question: Question; autoplay?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const media = question.mediaType === 'audio' ? audioRef.current : videoRef.current
    if (!media || question.mediaType === 'none' || !question.mediaUrl) return

    media.currentTime = 0
    if (autoplay) {
      const playPromise = media.play()
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {})
      }
    } else {
      media.pause()
    }
  }, [autoplay, question.id, question.mediaType, question.mediaUrl, question.mediaVersion])

  if (question.mediaType === 'none' || !question.mediaUrl) return null

  const source = assetUrl(question.mediaUrl)
  const key = `${question.id}-${question.mediaVersion ?? 'base'}-${question.mediaUrl}`

  if (question.mediaType === 'image') {
    return <img alt="" className="media-block media-visual" src={source} />
  }

  if (question.mediaType === 'audio') {
    return <audio key={key} className="media-block" controls autoPlay={autoplay} ref={audioRef} src={source} />
  }

  return <video key={key} className="media-block media-visual" controls autoPlay={autoplay} ref={videoRef} src={source} />
}
