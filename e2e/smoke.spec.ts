import { expect, test } from '@playwright/test'

/**
 * 這些測試不依賴 Fastify 後端。後端未啟動時 /api/agent/chat 會回錯誤，
 * UI 顯示 ⚠️ 訊息但版面轉場、權重面板、物件欄仍照常運作 —— 那正是這裡要測的。
 * 地圖 marker 與物件卡片來自 /api/rank（純 scoring，讀 data/app.db），跟 Fastify 無關。
 */

test('初始畫面顯示置中入口', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('entrance')).toBeVisible()
  await expect(page.getByTestId('composer-input')).toBeVisible()
  await expect(page.getByRole('button', { name: '買房' })).toBeVisible()
})

test('送出後入口淡出、地圖出現', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('map')).toBeVisible()
  await expect(page.getByTestId('entrance')).not.toBeVisible()
})

test('送出後輸入框仍存在——入口沒有被重新掛載', async ({ page }) => {
  await page.goto('/')
  const input = page.getByTestId('composer-input')
  await input.fill('台北的房子')
  await page.getByTestId('composer-submit').click()
  await expect(page.getByTestId('map')).toBeVisible()

  // 入口淡出但仍在 DOM 裡；若被卸載，count 會是 0
  await expect(input).toHaveCount(1)
})

test('修改權重開關浮動面板，七條 slider 都在', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('weight-panel')).toBeHidden()
  await page.getByTestId('weight-trigger').click()
  await expect(page.getByTestId('weight-panel')).toBeVisible()

  for (const label of ['房價可負擔', '同區性價比', '天氣環境', '地理位置', '生活機能', '坪數格局', '屋況條件']) {
    await expect(page.getByRole('slider', { name: label })).toHaveAttribute('aria-valuenow', '50')
  }

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('weight-panel')).toBeHidden()
})

test('物件欄可收納，收合後仍看得到筆數', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()
  await expect(page.getByTestId('listing-list')).toBeVisible()

  await page.getByTestId('listing-list-toggle').click()
  await expect(page.getByTestId('listing-list')).toBeHidden()
  await expect(page.getByTestId('listing-list-toggle')).toContainText('筆')

  await page.getByTestId('listing-list-toggle').click()
  await expect(page.getByTestId('listing-list')).toBeVisible()
})

test('點物件卡片後移開滑鼠，浮動卡片仍在——選取與 hover 是兩個狀態', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()
  await expect(page.getByTestId('listing-card').first()).toBeVisible()

  await page.getByTestId('listing-card').first().click()
  await expect(page.getByTestId('map-card')).toBeVisible()

  // 把滑鼠移到完全無關的位置；hover 態會消失，選取態不該消失
  await page.mouse.move(5, 5)
  await expect(page.getByTestId('map-card')).toBeVisible()
})

test('手機版以分頁切換', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('map')).toBeVisible()
  await page.getByRole('button', { name: '對話' }).click()
  await expect(page.getByTestId('chat-messages')).toBeVisible()
})
