import { useEffect, useState } from 'react'

export function useCountdown(closesAt: string | null, serverNow: string | null = null) {
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (!closesAt) {
      setSecondsLeft(0)
      return
    }

    const serverOffsetMs = serverNow ? new Date(serverNow).getTime() - Date.now() : 0
    const update = () => {
      const diff = Math.max(
        0,
        Math.ceil((new Date(closesAt).getTime() - (Date.now() + serverOffsetMs)) / 1000),
      )
      setSecondsLeft(diff)
    }

    update()
    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [closesAt, serverNow])

  return secondsLeft
}
