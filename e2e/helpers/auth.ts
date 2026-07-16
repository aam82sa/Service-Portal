import { expect, type Page } from '@playwright/test'

/**
 * Dev-mode sign-in against the seeded tester accounts (migration 00035).
 * Requires VITE_AUTH_MODE=dev and a stack seeded with the standard matrix.
 */
export const PASSWORD = 'AbcHub!2026'

export const USERS = {
  requester: 'biz1@dev.abccorp.com', // Basma Business
  itAgent: 'agent.it@dev.abccorp.com', // Adel IT Agent
  itHead: 'head.it@dev.abccorp.com', // Huda IT Head — dept head + approver
} as const

export async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto('/')
  await page.selectOption('select.input', email)
  // the form no longer prefills a password (nothing usable ships in the bundle)
  await page.fill('input[type="password"]', PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Overview')).toBeVisible({ timeout: 15_000 })
}

export async function signOut(page: Page): Promise<void> {
  await page.getByText('Sign out').click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 10_000 })
}

/**
 * Drill through the portal to a service form:
 * New request → department tile → "Request something" → category tile → service row.
 */
export async function openService(page: Page, deptTile: string, categoryTile: string, code: string): Promise<void> {
  await page.getByText('New request', { exact: true }).click()
  await expect(page.getByText('Choose a department')).toBeVisible({ timeout: 15_000 })
  await page.getByText(deptTile, { exact: true }).first().click()
  await page.getByText('Request something', { exact: true }).click()
  await page.getByText(categoryTile, { exact: true }).first().click()
  await page.locator(`.pc-row:has-text("${code}")`).first().click()
}

/** The confirmation screen's reference number (REQ-xxxx). */
export async function submittedRef(page: Page): Promise<string> {
  const ref = await page.locator('p.mono').first().textContent()
  expect(ref).toMatch(/^REQ-/)
  return ref!.trim()
}
