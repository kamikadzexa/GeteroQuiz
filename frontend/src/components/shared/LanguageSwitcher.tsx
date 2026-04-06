import { useI18n } from '../../context/I18nContext'
import type { Language } from '../../types'

export function LanguageSwitcher() {
  const { language, setLanguage } = useI18n()

  return (
    <div className="lang-switch">
      {(['en', 'ru'] as Language[]).map((option) => (
        <button
          key={option}
          className={option === language ? 'chip active' : 'chip'}
          onClick={() => setLanguage(option)}
          type="button"
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
