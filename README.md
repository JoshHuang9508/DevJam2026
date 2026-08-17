# 安家 — 台灣選址房仲 Agent

用自然語言描述想要的生活條件，透過多輪對話調整權重，在地圖上找到適合的房屋物件。

Repo 分兩層：Next.js 前端在根目錄，推薦後端在 [`backend/`](backend/)（Fastify + deterministic
ranking engine + Pi agent）。兩者的整合說明見 [`docs/backend-integration.md`](docs/backend-integration.md)。

## 快速開始

```bash
# 1. 推薦後端 → http://localhost:3001（Swagger UI 在 /docs）
cd backend && pnpm install && pnpm dev

# 2. 前端
pnpm install
cp .env.example .env.local   # 需要 Gemini 路徑才要填 GEMINI_API_KEY
mkdir data                   # drizzle-kit 不會自己建目錄
pnpm db:push                 # 建立 SQLite schema
pnpm db:seed                 # 灌入示範資料
pnpm dev
```

開啟 http://localhost:3000

## 路由

| 路徑 | 內容 | agent | 排序 |
| --- | --- | --- | --- |
| `/` | 主畫面：對話、權重面板、選區、地圖、物件卡片 | `backend/` 的 Pi agent（九個 domain tools） | 後端選行政區 → `lib/scoring` 在那些區內排物件 |
| `/classic` | Gemini 對話 + 權重面板 | Gemini（`lib/agent/`） | `lib/scoring` 直接對全池 |

`/` 需要 `backend/` 有在跑；`/classic` 不需要，方便單獨驗證 scoring engine 與 Gemini 路徑。
兩頁共用同一套 `SearchProfile`、`lib/scoring`、`components/`，localStorage 的 profile key
也一樣，設定會延續。

## 指令

| 指令 | 說明 |
| --- | --- |
| `pnpm dev` | 開發伺服器 |
| `pnpm test` | 單元測試 |
| `pnpm e2e` | 端對端測試（跑 `/classic`） |
| `pnpm test:all` | 全部測試 |
| `pnpm db:push` | 建立／更新資料庫 schema |
| `pnpm db:seed` | 重新產生示範資料 |

## 架構

**LLM 不做排序，只做參數萃取與結果說明。** 排序一律由純函式的 deterministic scoring engine
執行 —— 可單元測試、毫秒回應，權重面板拖動時完全不呼叫任何模型。

`/` 這條路徑再多一層：後端的 agent 先挑出適合的行政區（分數同樣由 deterministic ranking
engine 產生，模型不編分數），前 6 個行政區才交給 `lib/scoring` 在區內排物件。

設計文件：`docs/superpowers/specs/2026-08-17-taiwan-housing-agent-design.md`

## 目前的資料

示範資料涵蓋臺北市與新北市共 20 個行政區、360 筆物件，由 `scripts/seed.ts` 確定性產生。
氣候值為中央氣象署測站氣候平均的近似值，POI 與距離為模擬值。
後端 fixture 涵蓋全台 32 個行政區，臺北／新北的清單與氣候值與 `scripts/seed.ts` 對齊。
真實資料抓取與 enrich pipeline 見計畫 B。

## 風水體檢

排序的第八個維度。六條常見忌諱（穿堂煞、開門見灶、開門見廁、樑壓床、明堂狹窄、路衝／壁刀）
由 `lib/fengshui` 的確定性規則引擎判定 —— 同樣**不交給 LLM**，模型只負責把「我在意風水」
轉成權重變動。物件卡片會列出命中項目、傳統說法與裝潢角度的解法建議。

**預設權重是 0**，要自己拉起來才會作用。風水是信仰性偏好，不該預設替所有人選邊站；
權重 0 也代表沒開啟時排序結果與加這功能之前逐筆相同。

**證據是模擬的。** 判斷所需的八個 `fs*` 欄位由 `scripts/seed.ts` 依屋齡、坪數、樓層等特徵
擲骰產生，**系統並沒有真的辨識任何格局圖、照片或街景圖**。卡片上寫某間房子有穿堂煞，
不代表它真的有。真實 pipeline 要接的就是這一層 —— 介面已經留好，換掉證據來源即可，
規則引擎與 UI 都不用改。

風水是文化偏好而非科學結論，系統不預測吉凶，解法建議一律以裝潢、採光與噪音的角度陳述。

設計文件：[`docs/fengshui.md`](docs/fengshui.md)

## ⚠️ 尚未準備好上線部署

這是本地展示用途的專案，**不要直接部署到公開網路**。`/api/chat`、`/api/rank`、`/api/agent/*`
與 `/api/backend/*` 都沒有身分驗證、沒有速率限制，`request.json()` 也沒有限制請求大小上限。
`/api/chat` 每次請求會呼叫 Gemini 兩次（萃取一次、生成解釋文字一次）——公開曝露等於讓任何人
都能免費消耗你的 API 額度與伺服器記憶體，形成成本與記憶體的阻斷服務風險。

`/api/backend/*` 尤其要注意：它是推薦後端的**無驗證全方法代理**，等於把 `backend/` 整個
公開出去。它的存在只為了讓 cloudflare tunnel 這類單一入口的 demo 能運作，
本地開發、demo 沒有問題；若要對外提供服務，至少需要加上身分驗證、速率限制與請求大小限制。

## ⚠️ Gemini 路徑尚未經過品質驗證

自動化測試涵蓋的是**提示詞組裝、工具輸出驗證、失敗降級**，全部是純函式，不呼叫 API。
真正打 Gemini 的整合測試預設跳過，因為建置期間沒有 API 金鑰。

也就是說，以下三件事目前**沒有任何證據支持**，需要你自己驗證：

1. 使用者說一句話，條件是否被正確萃取（例如「1500 萬以內」→ `budgetMax: 1500`）
2. 模糊說法是否正確地**不會**變成硬條件（「不要太貴」應提高 price 權重，而非設 `budgetMax`）
3. 解釋文字是否真的講取捨、揭露放寬條件、以問句結尾

無金鑰時系統仍完整運作 —— 排序照常、地圖照常、對話顯示降級文案 —— 但 agent 不會真的理解你說什麼。

`/` 這條路徑不吃 `GEMINI_API_KEY`，改由 `backend/.env` 設定模型供應商；
畫面左上角的徽章會顯示目前跑的是 `pi-agent-core`（真的 LLM）還是 `deterministic-fallback`（規則式）。

### 怎麼驗證

```bash
# 1. 填入金鑰
echo 'GEMINI_API_KEY=你的金鑰' >> .env.local

# 2. 跑萃取的整合測試（四個中文語句 fixture，會產生少量費用）
RUN_LLM_TESTS=1 pnpm vitest run lib/agent/extract.integration.test.ts

# 3. 實際對話
pnpm dev
```

整合測試驗證的正是上面第 1、2 點。第 3 點需要人眼看 —— 送出
「我在信義區上班，預算 1500 萬以內，想要安靜、生活機能好」，
確認左側權重面板有維度閃爍並顯示 `50 → 70` 這樣的變化，且回覆有講取捨、結尾是問句。

若萃取品質不佳，調整的地方是 `lib/agent/prompts.ts` 的 `EXTRACT_SYSTEM_PROMPT`，
特別是五條硬規則中的第 2 條與第 5 條（hard 條件要保守、風水預設是權重而不是硬條件）——
這兩條是防止結果被濾成 0 筆的關鍵。
