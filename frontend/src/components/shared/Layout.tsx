import { Link, useLocation } from 'react-router-dom'
import { LanguageSwitcher } from './LanguageSwitcher'
import { useI18n } from '../../context/I18nContext'
import type { PropsWithChildren } from 'react'

export function Layout({ children }: PropsWithChildren) {
  const location = useLocation()
  const { t } = useI18n()

  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <header className="topbar">
        <Link className="brand" to="/">
          <span className="brand-badge">
            <img alt="Getero Quiz logo" className="brand-icon" src="/site-icon.jpg" />
          </span>
          <div>
            <strong>Getero Quiz</strong>
            <span>{t('brand.subtitle')}</span>
          </div>
        </Link>
        <div className="header-actions">
          <nav className="topnav topnav-compact">
            <Link className={location.pathname.startsWith('/admin') ? 'active' : ''} to="/admin">
              {t('nav.admin')}
            </Link>
            <Link className={!location.pathname.startsWith('/admin') ? 'active' : ''} to="/">
              {t('nav.play')}
            </Link>
          </nav>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="page-frame">{children}</main>
    </div>
  )
}
