import { expect, test } from '@playwright/test'

/**
 * 這些測試不依賴 Gemini 金鑰 —— /api/chat 在無金鑰時仍會回 profile、results 與降級文案，
 * 因此結果畫面必定出現內容。這是「永不空畫面」原則的迴歸測試。
 */

test('初始畫面顯示對話框與範例', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('composer-input')).toBeVisible()
  await expect(page.getByRole('button', { name: '買房' })).toBeVisible()
})

test('送出訊息後出現地圖與物件卡片', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('預算 2000 萬以內，想要生活機能好的地方')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('map')).toBeVisible()
  await expect(page.getByTestId('listing-card').first()).toBeVisible()
  await expect(page.getByTestId('chat-messages')).toContainText(/./)
})

test('拖動權重會改變結果順序', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()
  await expect(page.getByTestId('listing-card').first()).toBeVisible()

  const firstBefore = await page.getByTestId('listing-card').first().innerText()

  // 把「房價可負擔」拉到最高：聚焦該 slider 後用 End 鍵
  const priceSlider = page.getByRole('slider', { name: '房價可負擔' })
  await priceSlider.focus()
  await priceSlider.press('End')

  // 其餘維度拉到最低，放大排序差異
  for (const label of ['同區性價比', '天氣環境', '地理位置', '生活機能', '坪數格局', '屋況條件']) {
    const s = page.getByRole('slider', { name: label })
    await s.focus()
    await s.press('Home')
  }

  await expect(async () => {
    const firstAfter = await page.getByTestId('listing-card').first().innerText()
    expect(firstAfter).not.toBe(firstBefore)
  }).toPass()
})

test('權重面板的重設會把七個維度回到 50', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()
  await expect(page.getByTestId('weight-panel')).toBeVisible()

  const priceSlider = page.getByRole('slider', { name: '房價可負擔' })
  await priceSlider.focus()
  await priceSlider.press('End')
  await expect(priceSlider).toHaveAttribute('aria-valuenow', '100')

  await page.getByRole('button', { name: '重設' }).click()

  // 七個維度全部回到 50，不只被拖過的那一條
  for (const label of ['房價可負擔', '同區性價比', '天氣環境', '地理位置', '生活機能', '坪數格局', '屋況條件']) {
    await expect(page.getByRole('slider', { name: label })).toHaveAttribute('aria-valuenow', '50')
  }
})

test('切換到租房後價格以元/月顯示', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '租房' }).click()
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('listing-card').first()).toContainText('元/月')
})

test('卡片 hover 會標示為選中狀態', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  const first = page.getByTestId('listing-card').first()
  await expect(first).toBeVisible()
  await expect(first).not.toHaveClass(/border-blue-500/)

  await first.hover()
  await expect(first).toHaveClass(/border-blue-500/)
})

test('手機版以分頁切換對話與結果', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('chat-messages')).toBeVisible()
  await page.getByRole('button', { name: '結果' }).click()
  await expect(page.getByTestId('map')).toBeVisible()
})
