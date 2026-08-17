# 安家 — 台灣選址房仲 Agent

用自然語言描述想要的生活條件，透過多輪對話調整權重，在地圖上找到適合的房屋物件。

## 快速開始

```bash
pnpm install
cp .env.example .env.local   # 填入 GEMINI_API_KEY
pnpm db:push                 # 建立 SQLite schema
pnpm db:seed                 # 灌入示範資料
pnpm dev
```

開啟 http://localhost:3000

## 指令

| 指令 | 說明 |
| --- | --- |
| `pnpm dev` | 開發伺服器 |
| `pnpm test` | 單元測試 |
| `pnpm e2e` | 端對端測試 |
| `pnpm test:all` | 全部測試 |
| `pnpm db:push` | 建立／更新資料庫 schema |
| `pnpm db:seed` | 重新產生示範資料 |

## 架構

Gemini 只負責兩件事：把自然語言轉成 `SearchProfile` 的變動量，以及把排序結果寫成人話。
排序由 `lib/scoring` 的純函式完成 —— 可單元測試、毫秒回應，權重面板拖動時完全不呼叫 LLM。

設計文件：`docs/superpowers/specs/2026-08-17-taiwan-housing-agent-design.md`

## 目前的資料

示範資料涵蓋臺北市與新北市共 20 個行政區、360 筆物件，由 `scripts/seed.ts` 確定性產生。
氣候值為中央氣象署測站氣候平均的近似值，POI 與距離為模擬值。
真實資料抓取與 enrich pipeline 見計畫 B。

## ⚠️ Gemini 路徑尚未經過品質驗證

自動化測試涵蓋的是**提示詞組裝、工具輸出驗證、失敗降級**，全部是純函式，不呼叫 API。
真正打 Gemini 的整合測試預設跳過，因為建置期間沒有 API 金鑰。

也就是說，以下三件事目前**沒有任何證據支持**，需要你自己驗證：

1. 使用者說一句話，條件是否被正確萃取（例如「1500 萬以內」→ `budgetMax: 1500`）
2. 模糊說法是否正確地**不會**變成硬條件（「不要太貴」應提高 price 權重，而非設 `budgetMax`）
3. 解釋文字是否真的講取捨、揭露放寬條件、以問句結尾

無金鑰時系統仍完整運作 —— 排序照常、地圖照常、對話顯示降級文案 —— 但 agent 不會真的理解你說什麼。

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
特別是四條硬規則中的第 2 條（hard 條件要保守）——那條是防止結果被濾成 0 筆的關鍵。
