import { defineConfig, devices } from '@playwright/test'

// Dedicated port for Playwright so we never collide with a long-running
// `npm run dev` on 5173. Backend is assumed to be up on :8000 (run
// `make dev-backend` before `npm run test:e2e`).
const PORT = 5199
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  // Backend is in-memory and shared across tests — no parallelism.
  workers: 1,
  fullyParallel: false,
  retries: 0,

  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },

  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
