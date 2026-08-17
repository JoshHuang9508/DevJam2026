import type {
  AmenityStats,
  ClimateStats,
  DataQuality,
  GeographyStats,
  HousingStats,
  LocationBase,
  SourceMetadata,
  TransportStats,
} from "../domain/candidates/schema.js";
import type { PreferenceState } from "../domain/preferences/schema.js";

export interface ProviderResult<T> {
  data: T | null;
  quality: DataQuality;
  source: SourceMetadata | null;
  warning?: string;
}

export interface LocationProvider {
  search(preferences: PreferenceState, signal?: AbortSignal): Promise<LocationBase[]>;
  get(id: string, signal?: AbortSignal): Promise<LocationBase | null>;
}

export interface ClimateDataProvider {
  getClimate(location: LocationBase, signal?: AbortSignal): Promise<ProviderResult<ClimateStats>>;
}

export interface HousingDataProvider {
  getHousingStats(location: LocationBase, signal?: AbortSignal): Promise<ProviderResult<HousingStats>>;
}

export interface AmenityDataProvider {
  getAmenities(location: LocationBase, signal?: AbortSignal): Promise<ProviderResult<AmenityStats>>;
}

export interface TransportDataProvider {
  getTransport(location: LocationBase, signal?: AbortSignal): Promise<ProviderResult<TransportStats>>;
}

export interface GeographyDataProvider {
  getGeography(location: LocationBase, signal?: AbortSignal): Promise<ProviderResult<GeographyStats>>;
}

export interface ProviderRegistry {
  locations: LocationProvider;
  climate: ClimateDataProvider;
  housing: HousingDataProvider;
  amenities: AmenityDataProvider;
  transport: TransportDataProvider;
  geography: GeographyDataProvider;
}

