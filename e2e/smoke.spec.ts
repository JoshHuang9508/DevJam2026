import { expect, test } from '@playwright/test'

/**
 * 這些測試不依賴 Gemini 金鑰 —— /api/chat 在無金鑰時仍會回 profile、results 與降級文案，
 * 因此結果畫面必定出現內容。這是「永不空畫面」原則的迴歸測試。
 */

test('初始畫面顯示對話框與範例', async ({ page }) => {
  await page.goto('/classic')
  await expect(page.getByTestId('composer-input')).toBeVisible()
  await expect(page.getByRole('button', { name: '買房' })).toBeVisible()
})

test('送出訊息後出現地圖與物件卡片', async ({ page }) => {
  await page.goto('/classic')
  await page.getByTestId('composer-input').fill('預算 2000 萬以內，想要生活機能好的地方')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('map')).toBeVisible()
  await expect(page.getByTestId('listing-card').first()).toBeVisible()
  await expect(page.getByTestId('chat-messages')).toContainText(/./)
})

test('拖動權重會改變結果順序', async ({ page }) => {
  await page.goto('/classic')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()
  await expect(page.getByTestId('listing-card').first()).toBeVisible()

  const firstBefore = await page.getByTestId('listing-card').first().innerText()

  // 把「房價可負擔」拉到最高：聚焦該 slider 後用 End 鍵
  const priceSlider = page.getByRole('slider', { name: '房價可負擔' })
  await priceSlider.focus()
  await priceSlider.press('End')

  // 其餘維度拉到最低，放大排序差異（風水預設就是 0，這裡按 Home 是 no-op，
  // 但仍逐一列出，避免日後改了預設值時這個測試悄悄漏掉一個維度）
  for (const label of ['同區性價比', '天氣環境', '地理位置', '生活機能', '坪數格局', '屋況條件', '風水']) {
    const s = page.getByRole('slider', { name: label })
    await s.focus()
    await s.press('Home')
  }

  await expect(async () => {
    const firstAfter = await page.getByTestId('listing-card').first().innerText()
    expect(firstAfter).not.toBe(firstBefore)
  }).toPass()
})

test('權重面板的重設會把八個維度回到預設值（風水是 0，其餘 50）', async ({ page }) => {
  await page.goto('/classic')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()
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

  // 風水的預設是 0 而不是 50：信仰性偏好必須 opt-in，重設等於關掉它。
  // 這條同時守住「既有排序零回歸」—— 權重 0 代表這一維對總分沒有貢獻。
  await expect(fengshuiSlider).toHaveAttribute('aria-valuenow', '0')
})

test('切換到租房後價格以元/月顯示', async ({ page }) => {
  await page.goto('/classic')
  await page.getByRole('button', { name: '租房' }).click()
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('listing-card').first()).toContainText('元/月')
})

test('物件卡片會顯示風水體檢區塊', async ({ page }) => {
  await page.goto('/classic')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

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
  await page.goto('/classic')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()
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

test('卡片 hover 會標示為選中狀態', async ({ page }) => {
  await page.goto('/classic')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  const first = page.getByTestId('listing-card').first()
  await expect(first).toBeVisible()

  // 送出後游標停在原本送出鍵的位置，那裡已經換成地圖；maplibre 會對游標下的
  // marker 發 mouseenter → onHover(id) → 第一張卡片一開始就是選中狀態。
  // 先把游標移開地圖，才測得到「未選中 → 選中」的轉換。
  await page.mouse.move(0, 0)
  // hover 的邊框色是 neutral-800（此測試原本寫 blue-500，卡片早就不用那個色了，
  // 但本機從未安裝 playwright 瀏覽器，這條紅線一直沒被看見）
  await expect(first).not.toHaveClass(/border-neutral-800/)

  await first.hover()
  await expect(first).toHaveClass(/border-neutral-800/)
})

test('hard 條件會顯示為可移除的 chip（escape hatch）', async ({ page }) => {
  // 沒有 GEMINI_API_KEY 時萃取一律回空 delta，聊天路徑永遠不會產生 hard 條件，
  // 所以這裡改用 localStorage 直接種一個帶 hard.cities 的 profile —— 這正是
  // useSearchState 掛載時會讀取還原的同一個管道（Fix 2 驗證的也是這條路徑），
  // 藉此驅動畫面真的把 chip 畫出來，而不是繞過 UI 直接測資料層。
  //
  // weights 這裡刻意**不含** fengshui，同時當成向後相容的迴歸測試：加入風水維度之前存下的
  // 舊 profile 仍在使用者的 localStorage 裡，parseProfile 必須把缺的維度補成預設值（風水 = 0）
  // 而不是整包退回預設 —— 否則使用者的 hard 條件會在升級後無聲消失。
  await page.addInitScript(() => {
    const profile = {
      mode: 'sale',
      weights: { price: 50, value: 50, weather: 50, location: 50, amenities: 50, space: 50, quality: 50 },
      hard: { cities: ['臺北市'] },
      soft: {},
      notes: [],
    }
    window.localStorage.setItem('housing-agent.profile.v1', JSON.stringify(profile))
  })

  await page.goto('/classic')
  await page.getByTestId('composer-input').fill('隨便看看')
  await page.getByTestId('composer-submit').click()

  const constraints = page.getByTestId('hard-constraints')
  await expect(constraints).toBeVisible()
  const cityChip = constraints.getByRole('button', { name: '臺北市' })
  await expect(cityChip).toBeVisible()

  await cityChip.click()

  // 移除唯一的 hard 條件後，整塊 chip 區塊不再渲染（hard 已清空）
  await expect(page.getByTestId('hard-constraints')).toHaveCount(0)
})

test('手機版以分頁切換對話與結果', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/classic')
  await page.getByTestId('composer-input').fill('台北的房子')
  await page.getByTestId('composer-submit').click()

  await expect(page.getByTestId('chat-messages')).toBeVisible()
  await page.getByRole('button', { name: '結果' }).click()
  await expect(page.getByTestId('map')).toBeVisible()
})
