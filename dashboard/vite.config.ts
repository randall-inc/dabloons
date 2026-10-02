import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// Served by the Worker (../web) at /login and /dashboard/*. For hot reload,
// run `wrangler dev` in ../web and `npm run dev` here; /api is proxied to it.
export default defineConfig({
  base: '/dashboard/',
  build: { outDir: 'dist/dashboard', emptyOutDir: true },
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: { '/api': 'http://localhost:8787' },
    // ../shared/pricing.ts is imported from outside this folder.
    fs: { allow: ['..'] },
  },
})
