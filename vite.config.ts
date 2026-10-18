/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 다른 프로젝트의 5173 과 겹치지 않게 고정한다. 로그인 링크의 돌아올 주소(supabase/config.toml)와 같아야 한다
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // 날짜 로직이 한국 시간 기준이라 테스트도 같은 시간대로 고정
    env: { TZ: 'Asia/Seoul' },
  },
})
