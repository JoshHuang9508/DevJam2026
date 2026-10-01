import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";

const BASE_URL = "https://plvr.land.moi.gov.tw";
const CURRENT_URLS = {
  sale: `${BASE_URL}/opendata/lvr_landAcsv.zip`,
  rent: `${BASE_URL}/opendata/lvr_landCcsv.zip`,
} as const;

const CITY_BY_PREFIX: Record<string, string> = {
  a: "臺北市", b: "臺中市", c: "基隆市", d: "臺南市", e: "高雄市", f: "新北市",
  g: "宜蘭縣", h: "桃園市", i: "嘉義市", j: "新竹縣", k: "苗栗縣", m: "南投縣",
  n: "彰化縣", o: "新竹市", p: "雲林縣", q: "嘉義縣", t: "屏東縣", u: "花蓮縣",
  v: "臺東縣", w: "金門縣", x: "澎湖縣", z: "連江縣",
};

export interface LvrRecord {
  mode: "sale" | "rent";
  serial: string;
  city: string;
  district: string;
  address: string;
  price: number;
  unitPrice: number;
  area: number;
  layout: string;
  rooms: number;
  floor: number;
  totalFloor: number;
  age: number;
  buildingType: string;
  hasElevator: boolean;
  hasParking: boolean;
  transactedAt: string;
  note: string;
}

export interface LvrDataset {
  records: LvrRecord[];
  fetchedAt: number;
}

export async function fetchCurrentLvr(cacheDirectory: string, maxAgeMs = 12 * 60 * 60 * 1_000): Promise<LvrDataset> {
  const output: LvrRecord[] = [];
  let fetchedAt = 0;
  for (const mode of ["sale", "rent"] as const) {
    const cached = await fetchCached(CURRENT_URLS[mode], join(cacheDirectory, `lvr-current-${mode}.zip`), maxAgeMs);
    output.push(...parseZip(cached.bytes, mode));
    fetchedAt = Math.max(fetchedAt, cached.fetchedAt);
  }
  const seen = new Set<string>();
  return {
    records: output.filter((record) => {
      const key = `${record.mode}:${record.serial}`;
      if (!record.serial || seen.has(key)) return false;
      seen.add(key);
      return isResidential(record);
    }),
    fetchedAt,
  };
}

async function fetchCached(url: string, path: string, maxAgeMs: number): Promise<{ bytes: Uint8Array; fetchedAt: number }> {
  try {
    const file = await stat(path);
    if (Date.now() - file.mtimeMs < maxAgeMs) return { bytes: new Uint8Array(await readFile(path)), fetchedAt: file.mtimeMs };
  } catch {
    // Cache miss.
  }
  const response = await fetch(url, {
    headers: { "user-agent": "zhuchao-housing-agent/0.1 (+https://github.com/JoshHuang9508/DevJam2026)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`內政部實價登錄回應 ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 2_000) throw new Error(`內政部實價登錄檔案過小 (${bytes.byteLength} bytes)`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  // Use the persisted cache timestamp on both the download and cache-hit paths.
  // Returning a separate Date.now() here can differ by a millisecond and makes
  // an otherwise identical refresh re-embed every listing on its next run.
  const file = await stat(path);
  return { bytes, fetchedAt: file.mtimeMs };
}

function parseZip(bytes: Uint8Array, mode: "sale" | "rent"): LvrRecord[] {
  const suffix = mode === "sale" ? "a" : "c";
  const files = unzipSync(bytes);
  const records: LvrRecord[] = [];
  const decoder = new TextDecoder("utf-8");
  for (const [name, contents] of Object.entries(files)) {
    const match = /^([a-z])_lvr_land_([abc])\.csv$/.exec(name);
    if (!match || match[2] !== suffix) continue;
    const city = CITY_BY_PREFIX[match[1]!];
    if (!city) continue;
    for (const row of parseLvrCsv(decoder.decode(contents))) {
      const record = toRecord(row, city, mode);
      if (record) records.push(record);
    }
  }
  return records;
}

function toRecord(row: Record<string, string>, city: string, mode: "sale" | "rent"): LvrRecord | null {
  const district = row["鄉鎮市區"]?.trim();
  const address = normalizeAddress(row["土地位置建物門牌"] ?? "");
  if (!district || !address) return null;
  const total = Number(mode === "sale" ? row["總價元"] : row["總額元"]);
  const areaM2 = Number(mode === "sale" ? row["建物移轉總面積平方公尺"] : row["建物總面積平方公尺"]);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(areaM2) || areaM2 <= 0) return null;
  const parkingPrice = Number(mode === "sale" ? row["車位總價元"] : row["車位總額元"]) || 0;
  const parkingM2 = Number(mode === "sale" ? row["車位移轉總面積平方公尺"] : row["車位面積平方公尺"]) || 0;
  const netTotal = Math.max(total - parkingPrice, 0);
  const area = Math.max(areaM2 - parkingM2, 0) / 3.305785;
  if (netTotal <= 0 || area <= 0.5) return null;
  const price = mode === "sale" ? netTotal / 10_000 : netTotal;
  const rooms = Number(row["建物現況格局-房"]) || 0;
  const halls = Number(row["建物現況格局-廳"]) || 0;
  const baths = Number(row["建物現況格局-衛"]) || 0;
  const floor = parseFloor(mode === "sale" ? row["移轉層次"] : row["租賃層次"]);
  const totalFloor = parseFloor(row["總樓層數"]);
  const buildingType = row["建物型態"]?.trim() || "其他";
  return {
    mode,
    serial: row["編號"]?.trim() ?? "",
    city,
    district,
    address,
    price: round(price, 2),
    unitPrice: round(price / area, 3),
    area: round(area, 2),
    layout: rooms > 0 ? `${rooms}房${halls}廳${baths}衛` : area <= 15 ? "開放式" : "格局未登錄",
    rooms,
    floor: floor ?? 1,
    totalFloor: totalFloor ?? Math.max(floor ?? 1, 1),
    age: ageInYears(row["建築完成年月"]) ?? 0,
    buildingType,
    hasElevator: yesNo(row["電梯"] ?? row["有無電梯"]) ?? !/公寓|透天/.test(buildingType),
    hasParking: parkingPrice > 0 || parkingM2 > 0,
    transactedAt: rocDate(mode === "sale" ? row["交易年月日"] : row["租賃年月日"]) ?? "",
    note: row["備註"]?.trim() ?? "",
  };
}

function isResidential(record: LvrRecord): boolean {
  if (/車位|土地|農地|廠辦|辦公|店面|工廠|倉庫/.test(record.buildingType)) return false;
  if (/親友|自行|債務|解約|瑕疵|急買|急賣|畸零/.test(record.note)) return false;
  if (record.area < 3 || record.area > 200 || record.rooms > 10) return false;
  return record.mode === "sale"
    ? record.price >= 100 && record.price <= 30_000
    : record.price >= 3_000 && record.price <= 500_000;
}

function parseLvrCsv(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length < 3) return [];
  const header = rows[0]!;
  return rows.slice(2).map((row) => Object.fromEntries(header.map((key, index) => [key.trim(), row[index]?.trim() ?? ""])));
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (character !== "\r") field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalizeAddress(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").trim();
}

function parseFloor(value: string | undefined): number | null {
  const raw = normalizeAddress(value ?? "").replace(/層|樓/g, "");
  if (!raw) return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  const basement = raw.startsWith("地下");
  const body = basement ? raw.slice(2) : raw;
  if (!/^[零一二兩三四五六七八九十百]+$/.test(body)) return null;
  const digits: Record<string, number> = { "零": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  let total = 0;
  let current = 0;
  for (const character of body) {
    if (character === "百") { total += (current || 1) * 100; current = 0; }
    else if (character === "十") { total += (current || 1) * 10; current = 0; }
    else current = digits[character] ?? 0;
  }
  total += current;
  return total ? (basement ? -total : total) : null;
}

function rocDate(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!/^\d{6,7}$/.test(raw)) return null;
  const year = Number(raw.slice(0, -4)) + 1911;
  const month = Number(raw.slice(-4, -2));
  const day = Number(raw.slice(-2));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function ageInYears(value: string | undefined): number | null {
  const date = rocDate(value);
  if (!date) return null;
  const years = (Date.now() - new Date(date).getTime()) / (365.2425 * 86_400_000);
  return years < 0 ? null : round(years, 1);
}

function yesNo(value: string | undefined): boolean | null {
  if (value?.trim() === "有") return true;
  if (value?.trim() === "無") return false;
  return null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
