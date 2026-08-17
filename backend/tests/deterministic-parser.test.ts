import { describe, expect, it } from "vitest";
import { parsePreferencePatch } from "../src/agent/deterministic-parser.js";

/**
 * Covers only the fengshui rules. The parser runs when no model provider is configured
 * (`deterministic-fallback`), which is the state a demo machine is usually in — and the UI's own
 * example sentence mentions 風水, so this path has to understand it.
 */
describe("deterministic parser: 風水", () => {
  it("只說在意風水時調權重，不設硬條件", () => {
    const patch = parsePreferencePatch("我很在意風水，預算 2500 萬以內");
    expect(patch?.listingPreferences?.fengshuiWeight).toBeGreaterThan(0);
    // 誤設硬條件很容易把結果濾成 0 筆，所以模糊語氣一律只動權重。
    expect(patch?.listingPreferences?.avoidFengshui).toBeUndefined();
  });

  it("點名忌諱且語氣是排除時，升級成硬條件", () => {
    const patch = parsePreferencePatch("預算 2500 萬以內，很在意風水，不要穿堂煞和樑壓床，要有電梯");
    expect(patch?.listingPreferences?.avoidFengshui).toEqual(["throughDraft", "beamPressure"]);
    expect(patch?.listingPreferences?.fengshuiWeight).toBe(0.9);
  });

  it("認得六個忌諱的口語說法", () => {
    const cases: Array<[string, string]> = [
      ["有穿堂煞的不看", "throughDraft"],
      ["不要開門見灶", "stoveInSight"],
      ["有開門見廁的一律不看", "toiletFacingDoor"],
      ["絕對不要樑壓床", "beamPressure"],
      ["明堂太窄的不考慮", "narrowHall"],
      ["路衝的房子排除", "roadRush"],
    ];
    for (const [sentence, issue] of cases) {
      expect(parsePreferencePatch(sentence)?.listingPreferences?.avoidFengshui, sentence).toEqual([issue]);
    }
  });

  it("提到忌諱但語氣不是排除時，不設硬條件", () => {
    const patch = parsePreferencePatch("穿堂煞我可以接受，風水看看就好");
    expect(patch?.listingPreferences?.avoidFengshui).toBeUndefined();
    expect(patch?.listingPreferences?.fengshuiWeight).toBeGreaterThan(0);
  });

  it("句子裡別處的「不要」不該把提到的忌諱一併排除", () => {
    // 語氣判斷用的是忌諱名稱前後的窗格，不是整句話有沒有出現過否定詞。
    const patch = parsePreferencePatch("不要太貴，月租最高 20000，另外想了解一下穿堂煞是什麼");
    expect(patch?.listingPreferences?.avoidFengshui).toBeUndefined();
  });

  it("完全沒提到風水時不產生 listingPreferences", () => {
    const patch = parsePreferencePatch("中南部，月租最高 18000，希望少雨而且生活方便");
    expect(patch?.listingPreferences).toBeUndefined();
    // 其餘既有解析不受影響
    expect(patch?.hardConstraints?.regions).toEqual(["中部", "南部"]);
  });
});
