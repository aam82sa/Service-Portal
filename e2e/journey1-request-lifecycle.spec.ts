import { expect, test } from '@playwright/test'
import { USERS, openService, signInAs, signOut } from './helpers/auth'

/**
 * Golden journey 1 — the plain request lifecycle:
 * requester submits AC-03 (password/MFA reset) → IT agent triages, starts and
 * resolves it → the requester sees it resolved with the lifecycle bar sitting
 * on the Resolved step.
 */
test('AC-03 travels new → triaged → in progress → resolved end to end', async ({ page }) => {
  // ---- requester submits ----
  await signInAs(page, USERS.requester)
  await openService(page, ['IT services', 'Access & identity'], 'AC-03')
  const title = page.locator('input.input').first()
  await title.fill(`E2E password reset ${Date.now()}`)
  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByText(/submitted|REQ-/i).first()).toBeVisible()
  await signOut(page)

  // ---- agent triages and resolves ----
  await signInAs(page, USERS.itAgent)
  await page.getByText('Queue', { exact: true }).click()
  const row = page.locator('.row', { hasText: 'E2E password reset' }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Assign to me' }).click()
  await row.getByRole('button', { name: 'Triage' }).click()
  await row.getByRole('button', { name: 'Start' }).click()
  await row.getByRole('button', { name: 'Resolve' }).click()
  await expect(row.getByText('resolved')).toBeVisible()
  await signOut(page)

  // ---- requester sees resolved + lifecycle bar on the Resolved step ----
  await signInAs(page, USERS.requester)
  await page.getByText('My requests', { exact: true }).click()
  await page.locator('.row', { hasText: 'E2E password reset' }).first().click()
  await expect(page.locator('.chip', { hasText: 'resolved' }).first()).toBeVisible()
  const bar = page.locator('.lb')
  await expect(bar).toBeVisible()
  // the current (amber) node on the bar is Resolved — step 5 of the happy path
  await expect(bar.getByText('Resolved', { exact: true })).toBeVisible()
})
