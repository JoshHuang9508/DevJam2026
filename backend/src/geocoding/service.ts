import pg from "pg";

const { Pool } = pg;

export const geocodeSources = ["nominatim"] as const;
export const geocodePrecisions = ["exact", "approximate"] as const;

export interface GeocodeResult {
  lat: number;
  lng: number;
  source: typeof geocodeSources[number];
  precision: typeof geocodePrecisions[number];
  matchedAddress: string | null;
}

export interface GeocodingService {
  lookup(runId: string, addresses: string[], signal?: AbortSignal): Promise<Array<GeocodeResult | null>>;
  complete(runId: string): void;
  close(): Promise<void>;
}

export function createGeocodingService(options: {
  databaseUrl: string;
  baseUrl: string;
  userAgent: string;
  email?: string;
  budget: number;
  minIntervalMs: number;
}): GeocodingService {
  const pool = new Pool({ connectionString: options.databaseUrl });
  const spentByRun = new Map<string, number>();
  let lastRequestAt = 0;
  let requestChain = Promise.resolve();

  const lookupOne = async (runId: string, rawAddress: string, signal?: AbortSignal): Promise<GeocodeResult | null> => {
    const address = stripFloorSuffix(rawAddress);
    const cached = await pool.query<{ lat: number | null; lng: number | null; precision: "exact" | "approximate"; matched_address: string | null }>(
      "SELECT lat, lng, precision, matched_address FROM geocode_cache WHERE address = $1",
      [address],
    );
    if (cached.rows[0]) {
      const row = cached.rows[0];
      return row.lat === null || row.lng === null ? null : { lat: Number(row.lat), lng: Number(row.lng), source: "nominatim", precision: row.precision, matchedAddress: row.matched_address };
    }

    const spent = spentByRun.get(runId) ?? 0;
    if (spent >= options.budget) return null;
    spentByRun.set(runId, spent + 1);

    const result = await serialize(async () => {
      const elapsed = Date.now() - lastRequestAt;
      if (elapsed < options.minIntervalMs) await delay(options.minIntervalMs - elapsed, signal);
      lastRequestAt = Date.now();
      return callNominatim(address, options, signal);
    });

    if (result !== undefined) {
      await pool.query(
        `INSERT INTO geocode_cache (address, lat, lng, precision, matched_address, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (address) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, precision = excluded.precision, matched_address = excluded.matched_address, updated_at = now()`,
        [address, result?.lat ?? null, result?.lng ?? null, result?.precision ?? "approximate", result?.matchedAddress ?? null],
      );
    }
    return result ?? null;
  };

  const serialize = async <T>(task: () => Promise<T>): Promise<T> => {
    const next = requestChain.then(task, task);
    requestChain = next.then(() => undefined, () => undefined);
    return next;
  };

  return {
    async lookup(runId, addresses, signal) {
      const results: Array<GeocodeResult | null> = [];
      for (const address of addresses) results.push(await lookupOne(runId, address, signal));
      return results;
    },
    complete(runId) { spentByRun.delete(runId); },
    async close() { await pool.end(); },
  };
}

async function callNominatim(
  address: string,
  options: { baseUrl: string; userAgent: string; email?: string },
  signal?: AbortSignal,
): Promise<GeocodeResult | null | undefined> {
  const url = new URL("search", options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "tw");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  if (options.email) url.searchParams.set("email", options.email);
  const timeout = AbortSignal.timeout(20_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "accept-language": "zh-TW", "user-agent": options.userAgent },
      signal: combined,
    });
    if (response.status === 403 || response.status === 429) throw new Error(`Nominatim ${response.status}`);
    if (!response.ok) return undefined;
    const row = (await response.json() as Array<{ lat?: string; lon?: string; display_name?: string; address?: { house_number?: string } }>)[0];
    if (!row) return null;
    const point = { lat: Number(row.lat), lng: Number(row.lon) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !inTaiwan(point)) return null;
    return { ...point, source: "nominatim", precision: row.address?.house_number ? "exact" : "approximate", matchedAddress: row.display_name ?? null };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Nominatim ")) throw error;
    if (signal?.aborted) throw signal.reason;
    return undefined;
  }
}

function normalizeAddress(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").trim();
}

function stripFloorSuffix(value: string): string {
  return normalizeAddress(value)
    .replace(/([\d一二三四五六七八九十百]+樓(之\d+)?|地下[\d一二三四五六七八九十]*層?|頂樓加蓋)$/u, "")
    .replace(/[,，、]$/, "");
}

function inTaiwan(point: { lat: number; lng: number }): boolean {
  return point.lat >= 21.5 && point.lat <= 26.5 && point.lng >= 118.1 && point.lng <= 122.2;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}
