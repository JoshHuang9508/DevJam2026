import { test, expect } from '@playwright/test'

test('主畫面可載入', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toBeVisible()
})
