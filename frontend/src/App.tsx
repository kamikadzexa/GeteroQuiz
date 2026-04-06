import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { I18nProvider } from './context/I18nContext'
import { PlayerSessionProvider } from './context/PlayerSessionContext'
import { Layout } from './components/shared/Layout'
import { AdminDashboardPage } from './pages/AdminDashboardPage'
import { AdminSessionPage } from './pages/AdminSessionPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { DisplaySessionPage } from './pages/DisplaySessionPage'
import { LeaderboardPage } from './pages/LeaderboardPage'
import { PlayerJoinPage } from './pages/PlayerJoinPage'
import { QuizEditorPage } from './pages/QuizEditorPage'
import { QuizPlayPage } from './pages/QuizPlayPage'

function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <PlayerSessionProvider>
            <Layout>
              <Routes>
                <Route element={<PlayerJoinPage />} path="/" />
                <Route element={<DisplaySessionPage />} path="/display/:joinCode" />
                <Route element={<QuizPlayPage />} path="/play/:joinCode" />
                <Route element={<LeaderboardPage />} path="/leaderboard/:joinCode" />
                <Route element={<AdminDashboardPage />} path="/admin" />
                <Route element={<AdminUsersPage />} path="/admin/users" />
                <Route element={<AdminSessionPage />} path="/admin/sessions/:sessionId" />
                <Route element={<QuizEditorPage />} path="/admin/quizzes/:quizId" />
              </Routes>
            </Layout>
          </PlayerSessionProvider>
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  )
}

export default App
