import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = process.env.VITE_BACKEND_URL ?? env.VITE_BACKEND_URL
  if (command === 'build') {
    if (!backend?.trim()) throw new Error('Falta VITE_BACKEND_URL para compilar producción')
    let url: URL
    try { url = new URL(backend) } catch { throw new Error('VITE_BACKEND_URL no es una URL válida') }
    if (url.protocol !== 'https:' || url.origin !== backend.replace(/\/$/, '') || url.username || url.password) throw new Error('VITE_BACKEND_URL debe ser un origen HTTPS sin ruta ni credenciales')
  }
  return {
    plugins: [vue(), vueDevTools()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
  }
})
