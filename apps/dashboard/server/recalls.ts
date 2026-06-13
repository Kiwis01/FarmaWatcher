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

// La FDA publica el enforcement report en tandas (≈semanal), pero el cable
// acumula: una pasada por minuto contra openFDA suma lo nuevo a un almacén
// en memoria, así la lista crece en vez de mostrar solo la última página.
// El almacén vive con el proceso: se re-siembra con la página más reciente
// tras cada deploy/reinicio.
const WIRE_POLL_MS = Math.max(30, Number(process.env.WIRE_POLL_SEC ?? 60)) * 1000;
const WIRE_PAGE = 100;
const WIRE_MAX = 1000;
const wireStore = new Map<string, RecallRecord>();
let wireSource: LatestRecallsResult["source"] = "seed";
let wirePoller: ReturnType<typeof setInterval> | null = null;

function seedAsLatest(limit: number): LatestRecallsResult {
  const rows = [...seed().values()].sort(byReportDateDesc).slice(0, limit);
  return { source: "seed", recalls: rows };
}

function byReportDateDesc(a: RecallRecord, b: RecallRecord): number {
  return String(b.report_date ?? "").localeCompare(String(a.report_date ?? ""));
}

async function refreshWire(): Promise<void> {
  try {
    const key = process.env.OPENFDA_API_KEY;
    const auth = key ? `&api_key=${encodeURIComponent(key)}` : "";
    const url =
      `${openFdaBase()}/drug/enforcement.json` +
      `?sort=report_date:desc&limit=${WIRE_PAGE}${auth}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const data = (await res.json()) as { results?: RecallRecord[] };
    for (const r of data.results ?? []) {
      if (r.recall_number && !wireStore.has(r.recall_number)) {
        wireStore.set(r.recall_number, r);
      }
    }
    if (data.results?.length) wireSource = "openfda";
    if (wireStore.size > WIRE_MAX) {
      const keep = [...wireStore.values()].sort(byReportDateDesc).slice(0, WIRE_MAX);
      wireStore.clear();
      for (const r of keep) wireStore.set(r.recall_number, r);
    }
  } catch {
    // Offline o timeout: la próxima pasada reintenta; mientras, se sirve lo acumulado.
  }
}

export async function getLatestRecalls(limit = 50): Promise<LatestRecallsResult> {
  if (!wirePoller) {
    wirePoller = setInterval(() => void refreshWire(), WIRE_POLL_MS);
    wirePoller.unref?.();
  }
  if (wireStore.size === 0) await refreshWire();
  if (wireStore.size === 0) return seedAsLatest(limit);
  const recalls = [...wireStore.values()].sort(byReportDateDesc).slice(0, limit);
  return { source: wireSource, recalls };
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
