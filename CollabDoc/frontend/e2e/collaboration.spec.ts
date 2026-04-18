import { test, expect } from '@playwright/test'
import { newUser, registerViaUI, createDocument, typeInEditor } from './helpers'

// Two-browser-context test: the CRDT (bonus #1) is only meaningfully covered
// here — unit tests mock WebSocket but can't prove real propagation through
// the backend. If this test flakes, it almost certainly means the backend WS
// endpoint or the frontend YjsProvider regressed.
test.describe('real-time collaboration', () => {
  test('owner edits propagate to a second browser context via share link', async ({ browser }) => {
    // Owner context.
    const ownerCtx = await browser.newContext()
    const ownerPage = await ownerCtx.newPage()
    await registerViaUI(ownerPage, newUser('owner'))
    const docId = await createDocument(ownerPage)

    await ownerPage.getByRole('button', { name: /^share$/i }).click()
    await expect(ownerPage.getByRole('dialog', { name: /share document/i })).toBeVisible()

    // Mint a share link (default role=editor, expiry=7 days).
    await ownerPage.getByRole('button', { name: /^create link$/i }).click()
    const linkCode = ownerPage.locator('code.share-link-url').first()
    await expect(linkCode).toBeVisible({ timeout: 5_000 })
    const shareUrl = await linkCode.textContent()
    if (!shareUrl) throw new Error('share link URL missing')

    // Close modal.
    await ownerPage.getByRole('button', { name: /^close$/i }).click()

    // Collaborator context.
    const collabCtx = await browser.newContext()
    const collabPage = await collabCtx.newPage()
    await registerViaUI(collabPage, newUser('collab'))

    const path = new URL(shareUrl).pathname
    await collabPage.goto(path)
    await expect(collabPage).toHaveURL(new RegExp(`/documents/${docId}$`), { timeout: 10_000 })
    await expect(collabPage.locator('.ProseMirror')).toBeVisible()

    // Give both clients time to fully establish their WS sessions before the
    // first edit — otherwise typing can fire while the collaborator's Y.Doc
    // is still doing its initial handshake and the update is applied silently
    // to an empty doc on the other end.
    await ownerPage.waitForTimeout(1500)
    await collabPage.waitForTimeout(1500)

    // Owner types; collaborator should see it.
    await typeInEditor(ownerPage, 'hello from owner.')
    await expect(collabPage.locator('.ProseMirror')).toContainText('hello from owner.', {
      timeout: 20_000,
    })

    // Reverse direction.
    await typeInEditor(collabPage, ' reply from collab.')
    await expect(ownerPage.locator('.ProseMirror')).toContainText('reply from collab.', {
      timeout: 20_000,
    })

    await ownerCtx.close()
    await collabCtx.close()
  })
})
