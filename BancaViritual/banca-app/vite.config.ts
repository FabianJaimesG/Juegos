import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// En build (GitHub Pages) el sitio se sirve bajo /Juegos/ (nombre del repo).
// En desarrollo usa la raíz.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Juegos/' : '/',
  plugins: [react()],
}))
