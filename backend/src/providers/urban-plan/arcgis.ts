/**
 * Minimal ArcGIS REST client for the three cities' urban-planning MapServers.
 *
 * Two things about ArcGIS Server that shape this file:
 *  - It answers errors with HTTP 200 and an `{ error: { code } }` body, so the status code alone
 *    never tells you whether a query succeeded. Every response has to be inspected.
 *  - A point-in-polygon query returns nothing when the point lands on a road or a river, because
 *    those carry no zoning polygon. Callers therefore need an envelope (bbox) variant to sample
 *    the surrounding block; buffered `distance` queries do the same job but were measured an order
 *    of magnitude slower on these servers, so an envelope is used instead.
 */

/** Metres per degree of latitude — near enough constant for the envelope maths at this scale. */
const METRES_PER_LAT_DEGREE = 110_540;
/** Metres per degree of longitude at the equator; scaled by cos(latitude) at the query point. */
const METRES_PER_LON_DEGREE_AT_EQUATOR = 111_320;

export interface ArcgisFeature {
  attributes: Record<string, unknown>;
}

export interface ArcgisQueryInput {
  /** Service root, e.g. https://host/arcgis/rest/services/Folder/Service/MapServer */
  serviceUrl: string;
  layerId: number;
  latitude: number;
  longitude: number;
  outFields: string;
  /** 0 queries the bare point; a positive value samples a square of that radius around it. */
  radiusM: number;
  token?: string | undefined;
  referer?: string | undefined;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

export class ArcgisError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = "ArcgisError";
  }
}

/** ArcGIS token expiry / rejection. New Taipei re-fetches its public token and retries on this. */
export function isTokenError(error: unknown): boolean {
  return error instanceof ArcgisError && (error.code === 498 || error.code === 499);
}

export async function queryArcgisLayer(input: ArcgisQueryInput): Promise<ArcgisFeature[]> {
  const params = new URLSearchParams({
    f: "json",
    geometryType: input.radiusM > 0 ? "esriGeometryEnvelope" : "esriGeometryPoint",
    geometry: JSON.stringify(geometryFor(input)),
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: input.outFields,
    returnGeometry: "false",
  });
  if (input.token) params.set("token", input.token);

  const body = await fetchJson(`${input.serviceUrl}/${input.layerId}/query?${params.toString()}`, input);
  const error = (body as { error?: { code?: number; message?: string } }).error;
  if (error) throw new ArcgisError(error.message ?? "ArcGIS query failed", error.code);
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  return features
    .filter((feature): feature is ArcgisFeature => isRecord(feature) && isRecord(feature.attributes))
    .map((feature) => ({ attributes: feature.attributes }));
}

function geometryFor(input: ArcgisQueryInput): Record<string, unknown> {
  const spatialReference = { wkid: 4326 };
  if (input.radiusM <= 0) return { x: input.longitude, y: input.latitude, spatialReference };
  const halfLat = input.radiusM / METRES_PER_LAT_DEGREE;
  const halfLon = input.radiusM / (METRES_PER_LON_DEGREE_AT_EQUATOR * Math.cos((input.latitude * Math.PI) / 180));
  return {
    xmin: input.longitude - halfLon,
    ymin: input.latitude - halfLat,
    xmax: input.longitude + halfLon,
    ymax: input.latitude + halfLat,
    spatialReference,
  };
}

export async function fetchJson(
  url: string,
  options: { timeoutMs: number; signal?: AbortSignal | undefined; referer?: string | undefined; method?: "GET" | "POST"; jsonBody?: unknown },
): Promise<unknown> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const headers: Record<string, string> = { Accept: "application/json" };
  // These services are open to the public but several of them vary behaviour by Referer, so we send
  // the page a browser would have been on. It is not a credential and grants no extra access.
  if (options.referer) headers.Referer = options.referer;
  if (options.jsonBody !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (options.jsonBody === undefined ? "GET" : "POST"),
      headers,
      signal,
      ...(options.jsonBody === undefined ? {} : { body: JSON.stringify(options.jsonBody) }),
    });
  } catch (cause) {
    if (timeout.aborted) throw new ArcgisError(`Request timed out after ${options.timeoutMs}ms: ${url}`);
    throw new ArcgisError(cause instanceof Error ? cause.message : String(cause));
  }
  if (!response.ok) throw new ArcgisError(`HTTP ${response.status} from ${url}`, response.status);
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ArcgisError(`Response was not JSON (${text.slice(0, 120)})`);
  }
}

export async function fetchText(url: string, options: { timeoutMs: number; signal?: AbortSignal | undefined; referer?: string | undefined }): Promise<string> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(url, { headers: options.referer ? { Referer: options.referer } : {}, signal });
  if (!response.ok) throw new ArcgisError(`HTTP ${response.status} from ${url}`, response.status);
  return response.text();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ArcGIS string fields are routinely " " or "" rather than null. Treat those as absent. */
export function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Percentages arrive as numbers, numeric strings, or 0 meaning "not applicable" (roads, parks). */
export function optionalPercent(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}
