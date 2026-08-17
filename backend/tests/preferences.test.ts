import { describe, expect, it } from "vitest";
import { applyPreferencePatch, defaultPreferenceState, preferenceStateSchema } from "../src/domain/preferences/schema.js";

describe("PreferenceState", () => {
  it("deep-merges changes without losing previous state", () => {
    const first = applyPreferencePatch(defaultPreferenceState, {
      hardConstraints: { maxMonthlyRent: 18_000, regions: ["中部", "南部"] },
      softPreferences: { climate: { weight: 0.8, rainfall: { preference: "low", weight: 0.9 } } },
    });
    const second = applyPreferencePatch(first, {
      hardConstraints: { maxMonthlyRent: 22_000 },
      softPreferences: { transportation: { weight: 0.95, railwayAccess: 0.9 } },
    });
    expect(second.hardConstraints.regions).toEqual(["中部", "南部"]);
    expect(second.hardConstraints.maxMonthlyRent).toBe(22_000);
    expect(second.softPreferences.climate.rainfall.preference).toBe("low");
    expect(second.softPreferences.transportation.weight).toBe(0.95);
    expect(second.version).toBe(3);
  });

  it("carries listing-level fengshui intent without touching the five ranking dimensions", () => {
    expect(defaultPreferenceState.listingPreferences).toEqual({ fengshuiWeight: 0, avoidFengshui: [] });

    const updated = applyPreferencePatch(defaultPreferenceState, {
      listingPreferences: { fengshuiWeight: 0.8, avoidFengshui: ["throughDraft", "toiletFacingDoor"] },
    });

    expect(updated.listingPreferences.fengshuiWeight).toBe(0.8);
    expect(updated.listingPreferences.avoidFengshui).toEqual(["throughDraft", "toiletFacingDoor"]);
    // 行政區沒有「風水」這種屬性，所以這個區塊絕對不能滲進排序用的五維。
    expect(updated.softPreferences).toEqual(defaultPreferenceState.softPreferences);
    expect(Object.keys(updated.softPreferences).sort()).toEqual(["amenities", "climate", "geography", "housing", "transportation"]);
  });

  it("replaces avoidFengshui wholesale so a cleared list actually clears", () => {
    const set = applyPreferencePatch(defaultPreferenceState, { listingPreferences: { avoidFengshui: ["beamPressure"] } });
    // deep-merge 對陣列是整體覆寫而非合併 —— 這正是「取消避開某一項」需要的語意。
    const cleared = applyPreferencePatch(set, { listingPreferences: { avoidFengshui: [] } });
    expect(cleared.listingPreferences.avoidFengshui).toEqual([]);
    // 只動 avoidFengshui 不該把權重重設回 0
    const kept = applyPreferencePatch(
      applyPreferencePatch(defaultPreferenceState, { listingPreferences: { fengshuiWeight: 0.6 } }),
      { listingPreferences: { avoidFengshui: ["narrowHall"] } },
    );
    expect(kept.listingPreferences.fengshuiWeight).toBe(0.6);
  });

  it("keeps preferLowerRent when only housing.weight is patched", () => {
    // 迴歸測試：patch schema 若從 state schema 推導，欄位層的 `.default(1)` 會在 key 缺席時
    // 補值並覆蓋既有狀態 —— 使用者說過「不那麼在意租金高低」，下一句只調權重就被靜默還原。
    const relaxed = applyPreferencePatch(defaultPreferenceState, { softPreferences: { housing: { preferLowerRent: 0.3 } } });
    const reweighted = applyPreferencePatch(relaxed, { softPreferences: { housing: { weight: 0.9 } } });
    expect(reweighted.softPreferences.housing.preferLowerRent).toBe(0.3);
    expect(reweighted.softPreferences.housing.weight).toBe(0.9);
  });

  it("rejects an unknown fengshui issue rather than silently dropping it", () => {
    expect(() => applyPreferencePatch(defaultPreferenceState, {
      listingPreferences: { avoidFengshui: ["badLuck" as never] },
    })).toThrow();
  });

  it("rejects weights outside 0..1 and contradictory rent constraints", () => {
    expect(() => preferenceStateSchema.parse({ ...defaultPreferenceState, softPreferences: { ...defaultPreferenceState.softPreferences, housing: { weight: 1.1, preferLowerRent: 1 } } })).toThrow();
    expect(() => applyPreferencePatch(defaultPreferenceState, { hardConstraints: { minMonthlyRent: 20_000, maxMonthlyRent: 10_000 } })).toThrow();
  });
});

