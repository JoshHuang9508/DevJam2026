import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd()),
      // server-only 在 Next 的 server bundle 外會直接拋錯，
      // 換成空模組才能對 lib/db/client.ts 寫測試
      'server-only': path.resolve(process.cwd(), 'lib/test-utils/server-only-stub.ts'),
    },
  },
})
