const configured = import.meta.env.VITE_BACKEND_URL?.trim()
if (import.meta.env.PROD && !configured) {
  throw new Error('Falta VITE_BACKEND_URL en producción')
}
export const BACKEND_URL = configured?.replace(/\/$/, '') || 'http://localhost:4000'
