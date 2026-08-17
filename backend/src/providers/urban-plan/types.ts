import type { SourceMetadata } from "../../domain/candidates/schema.js";
import type { OverlayRecord, PlanCaseRecord, UrbanPlanCity, UrbanPlanReport, ZoningRecord } from "../../domain/urban-plan/schema.js";

export interface UrbanPlanLookupInput {
  latitude: number;
  longitude: number;
  /** Skips coordinate-based city resolution when the caller already knows the city. */
  city?: UrbanPlanCity | undefined;
}

export interface UrbanPlanProvider {
  lookup(input: UrbanPlanLookupInput, signal?: AbortSignal): Promise<UrbanPlanReport>;
}

export interface CityQuery {
  latitude: number;
  longitude: number;
  /** 0 asks for the parcel the point sits in; a positive value samples that radius around it. */
  radiusM: number;
  signal?: AbortSignal | undefined;
}

/** Everything that is not the zoning polygon itself: which plan governs the point, and what overlays hit it. */
export interface UrbanPlanContext {
  urbanPlanName: string | null;
  detailPlanNames: string[];
  planCases: PlanCaseRecord[];
  overlays: OverlayRecord[];
  warnings: string[];
}

export interface ZoneLookup {
  zones: ZoningRecord[];
  warnings: string[];
}

/** Bounding box used only to decide which city adapters are worth asking, never as an answer. */
export interface CityBounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

/**
 * One city's urban-planning GIS. Each implementation owns its own quirks (auth, coordinate system,
 * field naming) and reports the same two shapes back, so the router stays city-agnostic.
 */
export interface CityUrbanPlanSource {
  readonly city: UrbanPlanCity;
  readonly bounds: CityBounds;
  fetchZones(query: CityQuery): Promise<ZoneLookup>;
  fetchContext(query: CityQuery): Promise<UrbanPlanContext>;
  sourceMetadata(): SourceMetadata;
}

export const emptyContext = (): UrbanPlanContext => ({
  urbanPlanName: null,
  detailPlanNames: [],
  planCases: [],
  overlays: [],
  warnings: [],
});
