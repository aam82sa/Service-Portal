import { expect, test } from '@playwright/test'
import { USERS, openService, signInAs, signOut } from './helpers/auth'

/**
 * Golden journey 2 — DoA above the Tier 1 threshold:
 * HW-01 at 30,000 SAR builds the Tier 2 chain; the manager approves step 1,
 * the department-head step appears and approves, and the request returns to
 * in progress (the resolve gate opens).
 */
test('HW-01 at 30,000 SAR walks the Tier 2 DoA chain and reopens the resolve gate', async ({ page }) => {
  const marker = `E2E laptop batch ${Date.now()}`

  // ---- requester submits with an amount above the Tier 1 band ----
  await signInAs(page, USERS.requester)
  await openService(page, ['IT services', 'Hardware'], 'HW-01')
  await page.locator('input.input').first().fill(marker)
  await page.getByPlaceholder('SAR').fill('30000')
  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByText(/submitted|REQ-/i).first()).toBeVisible()
  await signOut(page)

  // ---- agent sends it for approval ----
  await signInAs(page, USERS.itAgent)
  await page.getByText('Queue', { exact: true }).click()
  const row = page.locator('.row', { hasText: marker }).first()
  await row.getByRole('button', { name: 'Assign to me' }).click()
  await row.getByRole('button', { name: 'Triage' }).click()
  await row.getByRole('button', { name: 'Start' }).click()
  await row.getByRole('button', { name: 'Send for approval' }).click()
  await expect(row.getByText('pending approval')).toBeVisible()
  await signOut(page)

  // ---- the dept head decides both chain steps in order ----
  await signInAs(page, USERS.itHead)
  await page.getByText('Approvals', { exact: true }).click()
  const card = page.locator('.card', { hasText: marker }).first()
  await expect(card).toBeVisible()
  await expect(card.getByText('Line manager')).toBeVisible()
  await card.getByRole('button', { name: 'Approve' }).click()
  // step 2 — the Tier 2 addition — becomes the pending step
  await expect(card.getByText('Department head')).toBeVisible()
  await card.getByRole('button', { name: 'Approve' }).click()
  await signOut(page)

  // ---- fully approved chain reopens the resolve gate ----
  await signInAs(page, USERS.itAgent)
  await page.getByText('Queue', { exact: true }).click()
  const after = page.locator('.row', { hasText: marker }).first()
  await expect(after.getByText('in progress')).toBeVisible()
  await expect(after.getByRole('button', { name: 'Resolve' })).toBeVisible()
})
