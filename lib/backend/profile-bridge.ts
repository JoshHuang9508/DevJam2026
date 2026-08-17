import type { Candidate, PreferencePatch, PreferenceState } from './types'
import { DEFAULT_PROFILE, type SearchProfile } from '@/lib/types/profile'

/**
 * Translates between the frontend's SearchProfile (listing-level, 7 axes) and the
 * backend's PreferenceState (district-level, 5 axes). They are deliberately not the
 * same model, so the mapping is lossy in both directions:
 *
 *   price + value  <->  softPreferences.housing.weight   (2:1, delta-preserving)
 *   weather        <->  softPreferences.climate.weight
 *   location       <->  softPreferences.transportation.weight
 *   amenities      <->  softPreferences.amenities.weight
 *   space, quality  ->  (no district-level equivalent; never overwritten)
 *   (none)         <-   softPreferences.geography.weight (district selection only)
 *
 * Hard constraints split the same way: region/city/rent live in the backend, while
 * 坪數/格局/屋齡/電梯/車位 stay listing-level and are passed through untouched.
 */

/** How many of the backend's ranked districts feed the listing search. */
export const DISTRICT_FANOUT = 6

const clamp100 = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : Math.round(v))
const toWeight = (v: number): number => Math.min(1, Math.max(0, Number((v / 100).toFixed(2))))

/** SearchProfile -> PreferencePatch. Sends only what the backend can represent. */
export function toPreferencePatch(profile: SearchProfile): PreferencePatch {
  const w = profile.weights
  const patch: PreferencePatch = {
    softPreferences: {
      housing: { weight: toWeight((w.price + w.value) / 2) },
      climate: { weight: toWeight(w.weather) },
      transportation: { weight: toWeight(w.location) },
      amenities: { weight: toWeight(w.amenities) },
    },
  }

  const hard: NonNullable<PreferencePatch['hardConstraints']> = {}
  if (profile.hard.cities?.length) hard.cities = profile.hard.cities
  // The backend only models monthly rent, so budgets are meaningless in sale mode
  // (萬元總價 vs 元月租 differ by orders of magnitude).
  if (profile.mode === 'rent') {
    const max = profile.hard.budgetMax
    const min = profile.hard.budgetMin
    if (typeof max === 'number' && max > 0) hard.maxMonthlyRent = Math.round(max)
    if (typeof min === 'number' && min > 0) hard.minMonthlyRent = Math.round(min)
  }
  if (Object.keys(hard).length > 0) patch.hardConstraints = hard

  return patch
}

/**
 * PreferenceState + the backend's district ranking -> SearchProfile.
 * `base` is the client's current profile; anything the backend cannot express
 * (mode, 坪數/格局/屋況 weights and constraints, commute anchor) is carried over.
 */
export function toSearchProfile(
  preferences: PreferenceState,
  districts: Candidate[],
  base: SearchProfile = DEFAULT_PROFILE,
): SearchProfile {
  const soft = preferences.softPreferences
  const hardIn = preferences.hardConstraints

  // housing is one axis for two sliders: shift both by the same delta so the user's
  // own price/value split survives an agent-driven change.
  const sentMean = (base.weights.price + base.weights.value) / 2
  const gotMean = soft.housing.weight * 100
  const shift = Math.abs(gotMean - sentMean) < 0.5 ? 0 : gotMean - sentMean

  const weights: SearchProfile['weights'] = {
    price: clamp100(base.weights.price + shift),
    value: clamp100(base.weights.value + shift),
    weather: clamp100(soft.climate.weight * 100),
    location: clamp100(soft.transportation.weight * 100),
    amenities: clamp100(soft.amenities.weight * 100),
    space: base.weights.space,
    quality: base.weights.quality,
  }

  const hard: SearchProfile['hard'] = { ...base.hard }
  if (hardIn.cities?.length) hard.cities = hardIn.cities
  else delete hard.cities
  // The backend picked these by ranking, not by user constraint — they are the
  // 選區 step feeding the listing search.
  const picked = districts.slice(0, DISTRICT_FANOUT).map((d) => d.district)
  if (picked.length > 0) hard.districts = [...new Set(picked)]
  else delete hard.districts

  if (base.mode === 'rent') {
    if (typeof hardIn.maxMonthlyRent === 'number') hard.budgetMax = hardIn.maxMonthlyRent
    if (typeof hardIn.minMonthlyRent === 'number') hard.budgetMin = hardIn.minMonthlyRent
  }

  const softOut: SearchProfile['soft'] = { ...base.soft }
  softOut.prefersLowRain = soft.climate.rainfall.preference === 'low'
  const preferredMax = soft.climate.temperature.preferredMax
  softOut.prefersCool = typeof preferredMax === 'number' && preferredMax <= 26

  return { mode: base.mode, weights, hard, soft: softOut, notes: base.notes }
}

/** Weight axes the agent moved this turn, for the panel's `交通 20 → 40` badge. */
export function weightDiff(
  before: SearchProfile,
  after: SearchProfile,
): Partial<Record<keyof SearchProfile['weights'], { from: number; to: number }>> {
  const out: Partial<Record<keyof SearchProfile['weights'], { from: number; to: number }>> = {}
  for (const key of Object.keys(after.weights) as Array<keyof SearchProfile['weights']>) {
    const from = before.weights[key]
    const to = after.weights[key]
    if (from !== to) out[key] = { from, to }
  }
  return out
}
