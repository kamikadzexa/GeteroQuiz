import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import en from '../i18n/en.json'
import ru from '../i18n/ru.json'
import type { Language } from '../types'

interface Dictionary {
  [key: string]: string | Dictionary
}

interface I18nContextValue {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: string) => string
}

const dictionaries: Record<Language, Dictionary> = { en, ru }
const I18nContext = createContext<I18nContextValue | null>(null)

function resolveKey(dictionary: Dictionary, key: string): string {
  return key.split('.').reduce<string | Dictionary>((acc, segment) => {
    if (typeof acc === 'string') return acc
    return acc[segment] ?? key
  }, dictionary) as string
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [language, setLanguage] = useState<Language>(
    () => (localStorage.getItem('quiz-language') as Language | null) || 'en',
  )

  useEffect(() => {
    localStorage.setItem('quiz-language', language)
  }, [language])

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: (key: string) => {
        const localized = resolveKey(dictionaries[language], key)
        if (localized !== key) {
          return localized
        }

        return resolveKey(dictionaries.en, key)
      },
    }),
    [language],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
