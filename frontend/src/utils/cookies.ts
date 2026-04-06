function decode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function getCookie(name: string) {
  const prefix = `${name}=`
  return document.cookie
    .split('; ')
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)
}

export function getJsonCookie<T>(name: string): T | null {
  const value = getCookie(name)
  if (!value) return null

  try {
    return JSON.parse(decode(value)) as T
  } catch {
    return null
  }
}

export function setCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax`
}

export function setJsonCookie(name: string, value: unknown, maxAgeSeconds: number) {
  setCookie(name, JSON.stringify(value), maxAgeSeconds)
}

export function deleteCookie(name: string) {
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
}
