import { expect, test } from '@playwright/test'
import { USERS, openService, signInAs, signOut, submittedRef } from './helpers/auth'

/**
 * Golden journey 2 — DoA above the Tier 1 threshold:
 * HW-01 at 30,000 SAR builds the full chain (line manager → department head →
 * executive per the 00034 band); the dept head — who inherits the approver
 * role — walks every step, and the request returns to in progress: the
 * resolve gate opens.
 */
test('HW-01 at 30,000 SAR walks the DoA chain and reopens the resolve gate', async ({ page }) => {
  // ---- requester submits with an amount above the Tier 1 band ----
  await signInAs(page, USERS.requester)
  await openService(page, 'IT services', 'Hardware', 'HW-01')
  await page.locator('select.input').last().selectOption('Laptop') // asset type
  await page.locator('input.input[type="text"]').first().fill('ThinkPad T14 batch') // model
  await page.getByPlaceholder('SAR').fill('30000') // estimated amount
  await page.locator('textarea.input').first().fill('Replacement laptops for the finance team (E2E journey).')
  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByText('Request submitted')).toBeVisible({ timeout: 15_000 })
  const ref = await submittedRef(page)
  await signOut(page)

  // ---- agent sends it for approval ----
  await signInAs(page, USERS.itAgent)
  await page.getByText('Department queue', { exact: true }).click()
  const row = page.locator('.row', { hasText: ref }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.getByRole('button', { name: 'Assign to me' }).click()
  await row.getByRole('button', { name: 'Triage' }).click()
  await row.getByRole('button', { name: 'Start' }).click()
  await row.getByRole('button', { name: 'Send for approval' }).click()
  await expect(row.getByText('pending approval')).toBeVisible()
  await signOut(page)

  // ---- the dept head decides the whole chain, step by step ----
  await signInAs(page, USERS.itHead)
  await page.getByText('Approvals', { exact: true }).click()
  const card = page.locator('.card', { hasText: ref }).first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card.getByText('30,000 SAR')).toBeVisible()
  for (let step = 1; step <= 3; step++) {
    await card.getByRole('button', { name: `Approve step ${step}` }).click({ timeout: 20_000 })
  }
  // fully decided — the card leaves the pending list
  await expect(card).not.toBeVisible({ timeout: 15_000 })
  await signOut(page)

  // ---- fully approved chain reopens the resolve gate ----
  await signInAs(page, USERS.itAgent)
  await page.getByText('Department queue', { exact: true }).click()
  const after = page.locator('.row', { hasText: ref }).first()
  await expect(after.getByText('in progress')).toBeVisible({ timeout: 15_000 })
  await expect(after.getByRole('button', { name: 'Resolve' })).toBeVisible()
})
