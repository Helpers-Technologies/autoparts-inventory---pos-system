import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // SECURITY: Minify and mangle all variable/function names
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,    // Remove ALL console.log/warn/error from production
        drop_debugger: true,   // Remove debugger statements
        passes: 2,
      },
      mangle: {
        toplevel: true,        // Mangle top-level names
      },
      format: {
        comments: false,       // Remove all comments
      },
    },
    // Reduce source-map exposure in production
    sourcemap: false,
  },
})
