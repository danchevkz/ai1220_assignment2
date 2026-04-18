import { test, expect } from '@playwright/test'
import { newUser, registerViaUI, loginViaUI } from './helpers'

test.describe('auth', () => {
  test('register lands on the dashboard', async ({ page }) => {
    await registerViaUI(page, newUser())
    await expect(page.getByRole('heading', { name: /your documents/i })).toBeVisible()
  })

  test('protected routes redirect to /login when signed out', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('login after register works from a fresh session', async ({ page, context }) => {
    const user = newUser()
    await registerViaUI(page, user)

    // Clear storage → next navigation forces re-auth through login.
    await context.clearCookies()
    await page.evaluate(() => localStorage.clear())

    await loginViaUI(page, user)
    await expect(page.getByRole('heading', { name: /your documents/i })).toBeVisible()
  })

  test('invalid login shows an error and stays on the login page', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Username').fill('nobody_here_123')
    await page.getByLabel('Password').fill('wrongpass1')
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })
})
