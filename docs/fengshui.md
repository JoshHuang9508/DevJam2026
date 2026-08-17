# 風水體檢

在既有的七個排序維度之外，加上第八個維度「風水」：用確定性規則引擎檢查六項常見的居家風水
忌諱，把結果變成 0..1 的分數餵進排序，並在物件卡片上列出命中項目與**裝潢角度**的解法建議。

**預設權重是 0**，也就是這個功能預設不影響任何排序結果。理由見下方〈為什麼預設權重是 0〉。

## 立場聲明

風水是**文化偏好，不是科學結論**。這個系統：

- **不預測吉凶。** 不主張任何格局會帶來財運、健康、運勢或意外的結果。
- 「傳統忌諱說明」欄位記錄的是**民間說法**，UI 上一律標示為「傳統說法：⋯」，不寫成事實陳述。
- 「解法建議」一律從**裝潢、採光、動線、噪音**的角度陳述 —— 玄關屏風是動線與隱私、
  隔音窗是噪音、鏡面與照明是視覺空間。這些即使完全不信風水也站得住腳。
- 分數只代表「與這六條傳統忌諱的吻合程度」，不代表房子好壞。權重面板拉到 0 就是完全不看。

## 誠實聲明：目前的證據是模擬值

`scripts/seed.ts` 產生的八個 `fs*` 證據欄位是**確定性模擬值**，由屋齡、坪數、樓層、
是否套房、是否無電梯公寓、離主要道路距離推導出機率後擲骰產生（固定亂數種子，可重現）。

**系統並沒有真的辨識任何格局圖、室內照片或街景圖。** 卡片上的「穿堂煞」不代表那間房子真的
大門對窗，只代表模擬器依該物件的屋況特徵擲出了這個值。demo 看到的分佈是合理的，個別物件的
判定不是真的。

真實 pipeline 要做的事，就是換掉這一層 —— 用格局圖／照片／街景圖的視覺模型填滿
`FengshuiEvidence` 這八個欄位。**介面已經留好，規則引擎、分數、排序、UI 全部不用改。**
種子資料也刻意讓約 5% 的物件缺格局圖、約 4% 缺街景，讓「未檢測 ≠ 無虞」這條路徑在 demo
上真的出現得到。

## 六條規則

| 風水項目 | 檢測依據 | 傳統忌諱說明 | 科學／裝潢解法建議 | 嚴重度 |
| --- | --- | --- | --- | --- |
| 穿堂煞 | 格局圖辨識：大門正對客廳窗戶或後門。 | 財來財去、難以聚財，氣場直來直往。 | 設置玄關屏風、半高鞋櫃、展示櫃或長效不透光布簾。 | 0.25 |
| 開門見灶 | 格局圖／照片：大門打開直接看見瓦斯爐。 | 火氣外露、容易破財與脾氣暴躁。 | 在爐灶與大門之間加裝拉門、屏風，或調整爐具位置。 | 0.15 |
| 開門見廁 | 格局圖／照片：大門打開直對馬桶或衛浴門。 | 穢氣迎人、影響健康與運勢。 | 衛浴門常閉、加裝隱藏門，或在門口掛風水簾並保持通風乾燥。 | 0.20 |
| 樑壓床／樑壓沙發 | 照片／高度數據：天花板大樑壓在床頭或沙發上方。 | 壓迫感重、容易頭痛、精神壓力大、運勢受壓抑。 | 透過木作天花板做圓弧形包覆修飾、避開壓頭處，或將床位平移。 | 0.15 |
| 明堂狹窄 | 格局圖：客廳採光面受阻或客廳縱深不足。 | 發展受限、前途黯淡、眼光短淺。 | 善用鏡面反射增加視覺空間、簡化家具配置、提升室內照明。 | 0.10 |
| 路衝／壁刀 | Google 街景圖：正對 T 字路口或鄰棟牆角切進來。 | 意外血光、車禍風險、氣場不穩。 | 裝設隔音窗、窗戶貼防爆膜，或透過陽台植栽進行視覺緩衝。 | 0.15 |

規則全文（含 `risk` 公式）在 [`lib/fengshui/rules.ts`](../lib/fengshui/rules.ts)。

### risk 公式

每條規則把證據換算成 0..1 的命中程度，**輸入不足一律回 `null`**（不是 0）：

| key | risk |
| --- | --- |
| `throughDraft` | `fsEntryWindowAligned * (1 - fsEntryScreen)` —— 有屏風即化解 |
| `stoveInSight` | `fsStoveVisibleFromDoor` |
| `toiletFacingDoor` | `fsToiletFacingDoor` |
| `beamPressure` | `fsBeamOverBed` |
| `narrowHall` | `max(fsDaylightBlocked, clamp01((3.6 - fsLivingRoomDepthM) / 1.2))` |
| `roadRush` | `fsRoadRush` |

明堂的縱深斜坡：3.6 公尺以上不算窄，2.4 公尺以下算滿分狹窄，中間線性內插。遮蔽與縱深取
**較嚴重者**而非相加，避免同一個問題被扣兩次分。

旗標欄位若經 `fillDataGaps` 的中位數補值會變成 0..1 的小數（不再只有 0/1），所以所有公式對
小數輸入都必須仍然單調且落在 0..1 —— 這是 `lib/fengshui/rules.test.ts` 明確測的性質。

## 資料流

```
listing_features 的八個 fs* 欄位          ← 真實 pipeline：視覺模型；目前：seed 模擬值
  │  （number | null，null = 未檢測）
  │
  ├──▶ lib/scoring/dimensions.ts  DIMENSIONS.fengshui  ← fengshuiSubscore()，未檢測算 0.5
  ├──▶ lib/scoring/filter.ts      hard.avoidFengshui   ← 硬條件排除（缺值不排除）
  └──▶ components/Fengshui/FengshuiCard.tsx            ← auditFengshui()，卡片上的體檢區塊
```

**三條路徑都吃未補值的原始證據**，`fillDataGaps` 的補值結果刻意不用在風水上。原因是旗標欄位
的補值語意壞掉了：0/1 旗標在基準率低於一半時，同區中位數**恆為 0**，補值等於把「沒有格局圖
可判」直接寫成「這一項沒問題」。連續型欄位（氣溫、POI 數）用中位數是合理估計，旗標不是 ——
照補值走的話，資料越少的物件風水分越高，最後排在最前面的會是沒人看得到格局的那些。示範資料
只有 5% 缺圖所以影響小，真實格局圖辨識的覆蓋率遠低於此，那時這個偏差會直接主導名次。

`fillDataGaps` 仍然會處理這八個欄位，只是結果只用在 `dataGaps` 清單上 —— 卡片右上角的
「補 N 項」因此仍會把缺格局圖算進去。

### 兩個分數，各有職責

```
auditFengshui().score  = 1 - Σ(severity × risk) / Σ(severity)   只計 risk !== null 的規則
fengshuiSubscore()     = 1 - Σ(severity × (risk ?? 0.5)) / Σ(severity)   六條全計
```

`auditFengshui().score` 回答「**已檢測**的項目表現如何」，未檢測的規則同時從分子與分母剔除，
六條全未檢測時為 `null`，卡片據此顯示「風水未檢測」而不是 0 分。

`fengshuiSubscore()` 回答「拿來**跟其他物件比**該給多少分」，未檢測以中性風險 0.5 計入，
恆為數字。未檢測必須落在中間：當 0 算會讓缺資料的物件虛胖，當 1 算則會無故把它們打死。

`risk >= FENGSHUI_HIT`（0.5）才算「命中」進 `issues`，依 `severity × risk` 由大到小排；
有檢測但低於門檻的進 `clear`。

### 進入排序

```ts
const fengshui: DimensionFn = (f) => fengshuiSubscore(f.listing.features)
```

`f.listing.features` 是原始欄位（`f.features` 才是補值後的），理由見上。之後與其他七個維度
一起 min-max 正規化、依權重加總 —— 風水在排序引擎眼中就只是第八個普通維度，沒有特殊路徑。

### 硬條件與放寬

`hard.avoidFengshui`（`FengshuiIssueKey[]`）讓使用者明確排除特定忌諱。過濾遵守專案的
**缺值不排除**不變量：只有 `ruleRisk(key, features) !== null` **且** `>= 0.5` 才排除；
未檢測的物件一律保留。

`lib/scoring/relax.ts` 把「拿掉 `avoidFengshui`」排在放寬行政區**之前** —— 信仰性偏好比
生活範圍容易讓步。訊息形如「暫時不排除有穿堂煞、路衝／壁刀的物件」。

## 為什麼判定不交給 LLM

這是專案既有不變量的延伸：**LLM 不做排序**。放到風水上，分工是

- **LLM 只做一件事**：把「我很在意風水」「不要開門見廁」這種自然語言，轉成
  `weights.fengshui` 與 `hard.avoidFengshui`。
- **命中判定完全由 `lib/fengshui` 做**：六條純函式，輸入是數字，輸出是數字。

那個「一件事」現在由**後端 Pi agent** 做（前端原本的 Gemini 萃取路徑在 `7c5bdaf` 移除）。
agent 把值寫進 `PreferenceState.listingPreferences`，`lib/backend/profile-bridge.ts` 再把它
換成前端的 `weights.fengshui` 與 `hard.avoidFengshui`。後端**只存不用** —— 它排的是行政區，
而穿堂煞是某一戶的格局，不是某一區的性質，所以這個區塊刻意放在 `softPreferences` 之外，
排序引擎完全不讀它。「風水預設是權重不是硬條件」那條規則現在寫在
`backend/src/agent/prompt.ts`。

理由：

1. **可測試。** 「縱深 3.0 公尺 + 無遮蔽 → risk 0.5」是可以寫成 assertion 的；
   「模型覺得這間明堂有點窄」不是。
2. **毫秒回應。** 權重面板拖動時要即時重排，不能每次都等模型。
3. **可重現、可解釋。** 同一筆物件今天明天都是同一個分數，而且能指著公式說為什麼。
   模型判定會抖，使用者截圖回報時無從追查。
4. **不會偷偷夾帶價值判斷。** 規則的文字是使用者提供的、寫死在 repo 裡、逐字可審查。
   讓模型自由發揮風水建議，等於讓它憑訓練資料生成命理內容 —— 那正是〈立場聲明〉要避免的。

## 為什麼預設權重是 0

`DEFAULT_PROFILE.weights.fengshui = 0`，其餘七個維度是 50。

1. **風水是信仰性偏好，必須 opt-in。** 不信的人不該被迫接受一個他不認同的排序理由；
   把它預設開啟等於替所有使用者選邊站。
2. **既有排序零回歸。** 權重 0 在 `normalizeWeights` 下佔不到任何比例，對總分的貢獻恆為 0，
   所以未開啟風水時，排序結果與加入本功能前**逐筆相同**。這是可驗證的性質，不是口頭承諾。
3. **卡片上的理由行不會被污染。** `ListingCard` 只從權重 > 0 的維度挑理由，
   否則會出現「− 風水相對弱」這種把排名歸咎於根本沒參與計分的項目的說明。

要開啟就把權重面板的「風水」拉起來，或直接跟 agent 說你在意風水。

## 相關檔案

| 檔案 | 內容 |
| --- | --- |
| `lib/types/fengshui.ts` | `FengshuiIssueKey`、`FengshuiFeatureKey`、`FengshuiEvidence`、`FengshuiRule` |
| `lib/fengshui/rules.ts` | 六條規則全文與 `risk` 公式 |
| `lib/fengshui/audit.ts` | `auditFengshui()`、`ruleRisk()`、`FENGSHUI_HIT` |
| `lib/scoring/dimensions.ts` | `DIMENSIONS.fengshui` |
| `lib/scoring/filter.ts` | `hard.avoidFengshui` 過濾（缺值不排除） |
| `lib/scoring/relax.ts` | 放寬步驟 |
| `components/Fengshui/FengshuiCard.tsx` | 卡片內的體檢區塊 |
| `scripts/seed.ts` | 八個 `fs*` 欄位的**模擬**產生邏輯 |
| `backend/src/domain/preferences/schema.ts` | `listingPreferences`：agent 寫入的風水權重與避開項 |
| `backend/src/agent/prompt.ts` | 「風水預設是權重不是硬條件」與「傳統說法」的敘述規則 |
| `lib/backend/profile-bridge.ts` | `listingPreferences` ↔ `weights.fengshui` / `hard.avoidFengshui` |
