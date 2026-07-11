import { expect, test } from '@playwright/test'
import { USERS, openService, signInAs, signOut, submittedRef } from './helpers/auth'

/**
 * Golden journey 1 — the plain request lifecycle:
 * requester submits AC-03 (password/MFA reset) → IT agent triages, starts and
 * resolves it → the requester sees it resolved with the lifecycle bar sitting
 * on the Resolved step.
 */
test('AC-03 travels new → triaged → in progress → resolved end to end', async ({ page }) => {
  // ---- requester submits ----
  await signInAs(page, USERS.requester)
  await openService(page, 'IT services', 'Access & identity', 'AC-03')
  // AC-03 form: account (text, required) + what-needs-resetting (dropdown, required)
  await page.locator('input.input[type="text"]').first().fill('basma@abccorp.com')
  await page.locator('select.input').last().selectOption('Password')
  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByText('Request submitted')).toBeVisible({ timeout: 15_000 })
  const ref = await submittedRef(page)
  await signOut(page)

  // ---- agent triages and resolves ----
  await signInAs(page, USERS.itAgent)
  await page.getByText('Department queue', { exact: true }).click()
  const row = page.locator('.row', { hasText: ref }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.getByRole('button', { name: 'Assign to me' }).click()
  await row.getByRole('button', { name: 'Triage' }).click()
  await row.getByRole('button', { name: 'Start' }).click()
  await row.getByRole('button', { name: 'Resolve' }).click()
  await expect(row.getByText('resolved')).toBeVisible()
  await signOut(page)

  // ---- requester sees resolved + lifecycle bar on the Resolved step ----
  await signInAs(page, USERS.requester)
  await page.getByText('My requests', { exact: true }).click()
  await page.locator('.row', { hasText: ref }).first().click()
  await expect(page.locator('.chip', { hasText: 'resolved' }).first()).toBeVisible({ timeout: 15_000 })
  const bar = page.locator('.lb')
  await expect(bar).toBeVisible()
  // the current node on the happy path — step 5 of new → … → resolved → closed
  await expect(bar.getByText('Resolved', { exact: true })).toBeVisible()
})
