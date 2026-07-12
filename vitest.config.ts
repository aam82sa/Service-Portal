import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'supabase/functions/**/render.test.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/features/assets/trackerParse.ts'],
    },
  },
})
