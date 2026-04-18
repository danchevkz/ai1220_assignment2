import { Page, expect } from '@playwright/test'

export interface TestUser {
  username: string
  email: string
  password: string
}

let counter = 0

// Unique per-run user. Timestamps + a monotonic counter keep each test isolated
// even when they execute within the same millisecond.
export function newUser(prefix = 'e2e'): TestUser {
  counter += 1
  const tag = `${Date.now().toString(36)}${counter}`
  return {
    username: `${prefix}_${tag}`,
    email: `${prefix}_${tag}@example.test`,
    password: 'Passw0rd!',
  }
}

export async function registerViaUI(page: Page, user: TestUser) {
  await page.goto('/register')
  await page.getByLabel('Username').fill(user.username)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByLabel('Confirm password').fill(user.password)
  await page.getByRole('button', { name: /create account/i }).click()
  // Registration redirects to '/' (dashboard).
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: /your documents/i })).toBeVisible()
}

export async function loginViaUI(page: Page, user: TestUser) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(user.username)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await expect(page).toHaveURL(/\/$/)
}

export async function createDocument(page: Page): Promise<string> {
  await page.getByRole('button', { name: /new document/i }).click()
  await expect(page).toHaveURL(/\/documents\/[^/]+$/)
  const match = page.url().match(/\/documents\/([^/]+)$/)
  if (!match) throw new Error(`Could not extract document id from ${page.url()}`)
  // Wait until the editor is actually mounted before returning.
  await expect(page.locator('.ProseMirror')).toBeVisible()
  return match[1]
}

export async function typeInEditor(page: Page, text: string) {
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await editor.pressSequentially(text, { delay: 10 })
}
