import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { validateDeploymentEnv } from '../shared/deploymentEnv.js'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build') validateDeploymentEnv(loadEnv(mode, process.cwd(), 'VITE_'));
  return {
    resolve: { dedupe: ['react', 'react-dom', 'leaflet', 'react-leaflet', 'lucide-react'] },
    plugins: [react(), tailwindcss()],
    server: {
      port: 5174,
      host: '127.0.0.1'
    }
  }
})
