import { useEffect, useState } from 'react'

export function useCountdown(closesAt: string | null) {
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (!closesAt) {
      setSecondsLeft(0)
      return
    }

    const update = () => {
      const diff = Math.max(0, Math.ceil((new Date(closesAt).getTime() - Date.now()) / 1000))
      setSecondsLeft(diff)
    }

    update()
    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [closesAt])

  return secondsLeft
}
