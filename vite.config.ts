import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/postcss'
import path from 'node:path'

/**
 * Uni Kasher Desktop frontend build.
 *
 * Vite emits static assets into the Tauri bundle. Runtime business data is
 * always handled by the SQLite-backed desktop API; there is no server-rendered web runtime
 * or browser database fallback in this product.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    watch: {
      ignored: ['**/src-tauri/target/**', '**/src-tauri/gen/**'],
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
