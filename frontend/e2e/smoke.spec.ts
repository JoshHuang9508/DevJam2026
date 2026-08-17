import { expect, test } from '@playwright/test'

/**
 * 這些測試不依賴 Fastify 後端。後端未啟動時 /api/agent/chat 會回錯誤，
 * UI 顯示 ⚠️ 訊息但版面轉場、權重面板、物件欄仍照常運作 —— 那正是這裡要測的。
 * 地圖 marker 與物件卡片來自 /api/rank（純 scoring，讀 data/app.db），跟 Fastify 無關。
 */

/** 送出一句話讓入口淡出、地圖與物件欄出現。幾乎每個測試都要先做這件事。 */
async function submitQuery(page: import('@playwright/test').Page, text = '台北的房子') {
  await page.goto('/')
  await page.getByTestId('composer-input').fill(text)
  await page.getByTestId('composer-submit').click()
}

test('初始畫面顯示置中入口', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('entrance')).toBeVisible()
  await expect(page.getByTestId('composer-input')).toBeVisible()
  await expect(page.getByRole('button', { name: '買房' })).toBeVisible()
})

test('送出後入口淡出、地圖出現', async ({ page }) => {
  await submitQuery(page)

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

test('修改權重開關浮動面板，八條 slider 都在', async ({ page }) => {
  await submitQuery(page)

  await expect(page.getByTestId('weight-panel')).toBeHidden()
  await page.getByTestId('weight-trigger').click()
  await expect(page.getByTestId('weight-panel')).toBeVisible()

  for (const label of ['房價可負擔', '同區性價比', '天氣環境', '地理位置', '生活機能', '坪數格局', '屋況條件']) {
    await expect(page.getByRole('slider', { name: label })).toHaveAttribute('aria-valuenow', '50')
  }
  // 風水的預設是 0 而不是 50：信仰性偏好必須由使用者主動 opt-in。
  // 這條同時守住「既有排序零回歸」—— 權重 0 代表這一維對總分沒有貢獻。
  await expect(page.getByRole('slider', { name: '風水' })).toHaveAttribute('aria-valuenow', '0')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('weight-panel')).toBeHidden()
})

test('權重面板的重設會把八個維度回到預設值（風水是 0，其餘 50）', async ({ page }) => {
  await submitQuery(page)
  await page.getByTestId('weight-trigger').click()
  await expect(page.getByTestId('weight-panel')).toBeVisible()

  const priceSlider = page.getByRole('slider', { name: '房價可負擔' })
  await priceSlider.focus()
  await priceSlider.press('End')
  await expect(priceSlider).toHaveAttribute('aria-valuenow', '100')

  // 風水也拖起來，才能證明重設是把它拉回 0，而不是它本來就沒被動過
  const fengshuiSlider = page.getByRole('slider', { name: '風水' })
  await fengshuiSlider.focus()
  await fengshuiSlider.press('End')
  await expect(fengshuiSlider).toHaveAttribute('aria-valuenow', '100')

  await page.getByRole('button', { name: '重設' }).click()

  // 七個維度回到 50，不只被拖過的那一條
  for (const label of ['房價可負擔', '同區性價比', '天氣環境', '地理位置', '生活機能', '坪數格局', '屋況條件']) {
    await expect(page.getByRole('slider', { name: label })).toHaveAttribute('aria-valuenow', '50')
  }
  await expect(fengshuiSlider).toHaveAttribute('aria-valuenow', '0')
})

test('物件欄可收納，收合後仍看得到筆數', async ({ page }) => {
  await submitQuery(page)
  await expect(page.getByTestId('listing-list')).toBeVisible()

  await page.getByTestId('listing-list-toggle').click()
  await expect(page.getByTestId('listing-list')).toBeHidden()
  await expect(page.getByTestId('listing-list-toggle')).toContainText('筆')

  await page.getByTestId('listing-list-toggle').click()
  await expect(page.getByTestId('listing-list')).toBeVisible()
})

test('點物件卡片後移開滑鼠，浮動卡片仍在——選取與 hover 是兩個狀態', async ({ page }) => {
  await submitQuery(page)
  await expect(page.getByTestId('listing-card').first()).toBeVisible()

  await page.getByTestId('listing-card').first().click()
  await expect(page.getByTestId('map-card')).toBeVisible()

  // 把滑鼠移到完全無關的位置；hover 態會消失，選取態不該消失
  await page.mouse.move(5, 5)
  await expect(page.getByTestId('map-card')).toBeVisible()
})

test('物件卡片會顯示風水體檢區塊', async ({ page }) => {
  await submitQuery(page)

  const firstCard = page.getByTestId('listing-card').first()
  await expect(firstCard).toBeVisible()

  // 風水權重預設 0（不參與排序），但體檢區塊仍必須畫出來 ——
  // 這一區是資訊揭露，不是排序理由，不該跟著權重一起消失
  await expect(firstCard.getByTestId('fengshui-card')).toBeVisible()
  await expect(firstCard).toContainText('風水')

  // 每張卡片都要有，缺證據的物件走的是「風水未檢測」那條分支而非整塊不渲染
  const cards = await page.getByTestId('listing-card').count()
  expect(await page.getByTestId('fengshui-card').count()).toBe(cards)

  // 不展開就要看得到模擬聲明：<details> 預設收合，把誠實標示只放在裡面等於預設藏起來
  await expect(firstCard).toContainText('風水格局證據皆為模擬值')

  // 「風水未檢測」分支不是 <details>，沒有可展開的容身處，聲明必須就地寫出來，
  // 否則那張卡片讀起來會像「本系統真的有讀格局圖，只是這間缺圖」
  const unaudited = page.getByTestId('fengshui-card').filter({ hasText: '風水未檢測' })
  if ((await unaudited.count()) > 0) {
    await expect(unaudited.first()).toContainText('並未真的辨識格局圖')
  }
})

test('展開風水體檢會看到傳統說法標示與模擬資料聲明', async ({ page }) => {
  await submitQuery(page)
  await expect(page.getByTestId('listing-card').first()).toBeVisible()

  // 只有「有檢測到證據」的卡片才是可展開的 <details>；種子資料約 5% 物件缺格局圖，
  // 走的是不可展開的「風水未檢測」分支，所以這裡要挑出有分數的那種。
  const audited = page.getByTestId('fengshui-card').filter({ hasText: '風水體檢' }).first()
  await expect(audited).toBeVisible()
  await audited.locator('summary').click()

  // 誠實標示是硬性要求：風水是文化偏好，且示範資料的格局證據是模擬值。
  // 這兩句話若被改掉或刪掉，這個測試就要紅 —— 它們不是裝飾文案。
  await expect(audited).toContainText('文化偏好')
  await expect(audited).toContainText('模擬值')

  // 命中的忌諱必須標成「傳統說法」，不能讓民間說法讀起來像結論
  const withIssue = page.getByTestId('fengshui-card').filter({ hasText: '命中' }).first()
  await expect(withIssue).toBeVisible()
  await withIssue.locator('summary').click()
  await expect(withIssue).toContainText('傳統說法')
  await expect(withIssue).toContainText('解法')
})

test('手機版以分頁切換', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await submitQuery(page)

  await expect(page.getByTestId('map')).toBeVisible()
  await page.getByRole('button', { name: '對話' }).click()
  await expect(page.getByTestId('chat-messages')).toBeVisible()
})
