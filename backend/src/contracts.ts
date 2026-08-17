export { agentEventSchema, type AgentEvent } from "./agent/events.js";
export {
  amenityStatsSchema,
  candidateSchema,
  climateStatsSchema,
  dataQualitySchema,
  geographyStatsSchema,
  housingStatsSchema,
  locationBaseSchema,
  sourceMetadataSchema,
  transportStatsSchema,
  type Candidate,
  type LocationBase,
} from "./domain/candidates/schema.js";
export {
  defaultPreferenceState,
  preferencePatchSchema,
  preferenceStateSchema,
  type PreferencePatch,
  type PreferenceState,
} from "./domain/preferences/schema.js";
export { searchSessionSchema, type SearchSession } from "./domain/sessions/schema.js";

