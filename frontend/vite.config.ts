import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:4000'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': proxyTarget,
        '/uploads': proxyTarget,
        '/quiz-data': proxyTarget,
        '/socket.io': {
          target: proxyTarget,
          ws: true,
        },
      },
    },
  }
})
