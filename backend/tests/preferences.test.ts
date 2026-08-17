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

  it("rejects weights outside 0..1 and contradictory rent constraints", () => {
    expect(() => preferenceStateSchema.parse({ ...defaultPreferenceState, softPreferences: { ...defaultPreferenceState.softPreferences, housing: { weight: 1.1, preferLowerRent: 1 } } })).toThrow();
    expect(() => applyPreferencePatch(defaultPreferenceState, { hardConstraints: { minMonthlyRent: 20_000, maxMonthlyRent: 10_000 } })).toThrow();
  });
});

