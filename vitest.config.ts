import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      DATABASE_URL: 'mongodb://localhost:27017/omnidrive-test',
      TOKEN_ENCRYPTION_KEY: 'test-key-material-32-chars-minimum!',
      AUTH_SECRET: 'test-auth-secret-32-chars-minimum!!',
    },
  },
})
