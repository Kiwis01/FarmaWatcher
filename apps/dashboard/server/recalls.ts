import { readFileSync } from "node:fs";

// Detalle de un recall para el dossier del dashboard.
// Orden de resolución: fixture local (determinista, funciona offline) -> openFDA en vivo.

export interface RecallRecord {
  recall_number: string;
  [k: string]: unknown;
}

export interface RecallDetailResult {
  source: "seed" | "openfda";
  record: RecallRecord;
}

const SEED_URL = new URL("../../../demo/seed-data/recalls.json", import.meta.url);

let seedIndex: Map<string, RecallRecord> | null = null;

function seed(): Map<string, RecallRecord> {
  if (!seedIndex) {
    seedIndex = new Map();
    try {
      const rows = JSON.parse(readFileSync(SEED_URL, "utf8")) as RecallRecord[];
      for (const r of rows) {
        if (r.recall_number) seedIndex.set(r.recall_number, r);
      }
    } catch {
      // Sin fixture: resolvemos todo contra openFDA.
    }
  }
  return seedIndex;
}

// Los recalls publicados no cambian: cache largo para aciertos, corto para fallas
// (para reintentar cuando vuelva la red sin tumbar el rate limit de openFDA).
const OK_TTL_MS = 60 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;
const cache = new Map<string, { at: number; value: RecallDetailResult | null }>();

function openFdaBase(): string {
  return (process.env.OPENFDA_BASE ?? "https://api.fda.gov").replace(/\/$/, "");
}

export function isValidRecallId(id: string): boolean {
  return /^[\w.-]{1,40}$/.test(id);
}

/* ── Cable openFDA: los últimos recalls publicados, con o sin paciente ── */

export interface LatestRecallsResult {
  source: "seed" | "openfda";
  recalls: RecallRecord[];
}

// La FDA publica el enforcement report semanalmente: 10 min de caché sobra
// para una pantalla en vivo sin acercarse al rate limit.
const WIRE_OK_TTL_MS = 10 * 60 * 1000;
const WIRE_FAIL_TTL_MS = 60 * 1000;
let wireCache: { at: number; value: LatestRecallsResult } | null = null;

function seedAsLatest(limit: number): LatestRecallsResult {
  const rows = [...seed().values()]
    .sort((a, b) => String(b.report_date ?? "").localeCompare(String(a.report_date ?? "")))
    .slice(0, limit);
  return { source: "seed", recalls: rows };
}

export async function getLatestRecalls(limit = 12): Promise<LatestRecallsResult> {
  if (wireCache) {
    const ttl = wireCache.value.source === "openfda" ? WIRE_OK_TTL_MS : WIRE_FAIL_TTL_MS;
    if (Date.now() - wireCache.at < ttl) return wireCache.value;
  }

  let value: LatestRecallsResult | null = null;
  try {
    const key = process.env.OPENFDA_API_KEY;
    const auth = key ? `&api_key=${encodeURIComponent(key)}` : "";
    const url =
      `${openFdaBase()}/drug/enforcement.json` +
      `?sort=report_date:desc&limit=${limit}${auth}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = (await res.json()) as { results?: RecallRecord[] };
      if (data.results?.length) value = { source: "openfda", recalls: data.results };
    }
  } catch {
    // Offline o timeout: degradamos al fixture local.
  }
  if (!value) value = seedAsLatest(limit);
  wireCache = { at: Date.now(), value };
  return value;
}

export async function getRecallDetail(id: string): Promise<RecallDetailResult | null> {
  const local = seed().get(id);
  if (local) return { source: "seed", record: local };

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < (hit.value ? OK_TTL_MS : FAIL_TTL_MS)) {
    return hit.value;
  }

  let value: RecallDetailResult | null = null;
  try {
    const url =
      `${openFdaBase()}/drug/enforcement.json` +
      `?search=recall_number:%22${encodeURIComponent(id)}%22&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = (await res.json()) as { results?: RecallRecord[] };
      if (data.results?.[0]) value = { source: "openfda", record: data.results[0] };
    }
    // 404 de openFDA = "no hay coincidencias": se cachea como null.
  } catch {
    // Offline o timeout: el front degrada con gracia mostrando lo que trae el evento.
  }
  cache.set(id, { at: Date.now(), value });
  return value;
}
