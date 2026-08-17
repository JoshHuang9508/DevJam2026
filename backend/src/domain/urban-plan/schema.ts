import { z } from "zod";
import { dataQualitySchema, sourceMetadataSchema } from "../candidates/schema.js";

/** Cities whose urban-planning GIS we have a verified adapter for. */
export const urbanPlanCitySchema = z.enum(["臺北市", "新北市", "基隆市"]);

/**
 * How the coordinate was resolved against the zoning polygons.
 * `parcel` = the point itself falls inside a zoning polygon, i.e. authoritative for that address.
 * `nearby` = the point fell in a gap (roads and rivers carry no zoning polygon in these datasets),
 *            so the surrounding block was sampled instead; useful context, not a legal answer.
 */
export const urbanPlanMatchSchema = z.enum(["parcel", "nearby", "none"]);

export const zoningRecordSchema = z.object({
  zoneName: z.string().nullable(),
  zoneCode: z.string().nullable(),
  zoneShortName: z.string().nullable(),
  /** 建蔽率 %. Null whenever the source leaves it blank — never inferred from the zone name. */
  buildingCoveragePct: z.number().nullable(),
  /** 容積率 %. Same rule as buildingCoveragePct. */
  floorAreaRatioPct: z.number().nullable(),
  note: z.string().nullable(),
});

export const planCaseRecordSchema = z.object({
  planName: z.string(),
  planNumber: z.string().nullable(),
  /** 公告文號 or 公告日期, verbatim from the source. */
  publication: z.string().nullable(),
  /** Document kinds the source says exist for this case (計畫書 / 計畫圖 / …). */
  documents: z.array(z.string()),
});

/** Thematic restriction areas the coordinate falls inside (都市更新, 山坡地, 禁限建, 都審 …). */
export const overlayRecordSchema = z.object({
  name: z.string(),
  detail: z.string().nullable(),
});

export const urbanPlanReportSchema = z.object({
  city: urbanPlanCitySchema,
  coordinate: z.object({ latitude: z.number(), longitude: z.number() }),
  match: urbanPlanMatchSchema,
  /** Radius actually sampled, in metres. 0 for a parcel hit, null when nothing was found. */
  searchRadiusM: z.number().nullable(),
  zones: z.array(zoningRecordSchema),
  urbanPlanName: z.string().nullable(),
  detailPlanNames: z.array(z.string()),
  planCases: z.array(planCaseRecordSchema),
  overlays: z.array(overlayRecordSchema),
  quality: dataQualitySchema,
  sources: z.array(sourceMetadataSchema),
  /** Layers that failed or coverage gaps. Present so a partial answer never reads as a complete one. */
  warnings: z.array(z.string()),
});

export type UrbanPlanCity = z.infer<typeof urbanPlanCitySchema>;
export type UrbanPlanMatch = z.infer<typeof urbanPlanMatchSchema>;
export type ZoningRecord = z.infer<typeof zoningRecordSchema>;
export type PlanCaseRecord = z.infer<typeof planCaseRecordSchema>;
export type OverlayRecord = z.infer<typeof overlayRecordSchema>;
export type UrbanPlanReport = z.infer<typeof urbanPlanReportSchema>;
