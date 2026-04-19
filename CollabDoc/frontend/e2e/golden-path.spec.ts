import { test, expect } from '@playwright/test'
import { newUser, registerViaUI, createDocument, typeInEditor } from './helpers'

// End-to-end demo flow: register → create doc → rich-text edit → AI rewrite →
// accept → version history. The collaboration.spec.ts test covers cross-client
// WS persistence separately — here we stay within a single session so the
// assertions don't race the Yjs FileYStore flush.

test.describe('golden path', () => {
  test('create document, edit with rich text, title auto-saves', async ({ page }) => {
    await registerViaUI(page, newUser())
    await createDocument(page)

    await page.getByLabel('Document title').fill('Playwright Test Doc')
    await typeInEditor(page, 'hello world.')

    // Bold the last word via toolbar.
    const editor = page.locator('.ProseMirror')
    await editor.press('Shift+Home')
    await page.getByRole('button', { name: /^bold$/i }).click()
    await expect(editor.locator('strong')).toBeVisible()

    // Give the title debounce (1s) a moment to fire the PATCH.
    await page.waitForTimeout(1500)
    await expect(editor).toContainText('hello world.')
    await expect(page.getByLabel('Document title')).toHaveValue('Playwright Test Doc')
  })

  test('AI rewrite streams, partial accept applies the chunk', async ({ page }) => {
    await registerViaUI(page, newUser())
    await createDocument(page)
    await typeInEditor(page, 'this is a test sentence. another one follows here.')

    const editor = page.locator('.ProseMirror')
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Meta+A')

    await page.getByRole('button', { name: /^ai$/i, exact: false }).first().click()
    await expect(page.getByRole('complementary', { name: /ai assistant/i })).toBeVisible()

    await page.getByRole('button', { name: /^rewrite$/i }).click()

    const applyBtn = page.getByRole('button', { name: /^apply (all|selected)$/i })
    await expect(applyBtn).toBeVisible({ timeout: 10_000 })
    await applyBtn.click()

    // Mock provider capitalizes each sentence start.
    await expect(editor).toContainText(/This is a test sentence\. Another one follows here\./)
  })

  test('version history drawer opens and lists the current document state', async ({ page }) => {
    await registerViaUI(page, newUser())
    await createDocument(page)
    await typeInEditor(page, 'content for version snapshot.')

    // Give Yjs a beat to broadcast before we open history — the GET /versions
    // call triggers a server-side snapshot of whatever the WS room currently
    // holds.
    await page.waitForTimeout(2000)

    await page.getByRole('button', { name: /^history$/i }).click()
    await expect(page.getByRole('dialog', { name: /version history/i })).toBeVisible()

    // The v1 snapshot is created at document creation (empty content), and
    // opening /versions triggers a second snapshot of the live WS room after
    // the Yjs edit above — so we expect ≥1 version item, typically 2.
    const versionItems = page.locator('.version-item')
    await expect(versionItems.first()).toBeVisible({ timeout: 10_000 })

    // Restoring the most recent version should succeed (dialog closes).
    page.once('dialog', d => d.accept())
    await page.getByRole('button', { name: /restore this version/i }).first().click()
    await expect(page.getByRole('dialog', { name: /version history/i })).not.toBeVisible({
      timeout: 10_000,
    })
  })
})
