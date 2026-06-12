import { readFileSync } from "node:fs";

export interface EventRow {
  ts: string;
  kind: string;
  payload: string;
}

export interface EventsResult {
  source: "clickhouse" | "local" | "backup";
  events: EventRow[];
  error?: string;
}

// Espejo local que escribe el worker (datos reales, sin depender de ClickHouse).
const LIVE_URL = new URL(
  "../../../demo/seed-data/events-live.json",
  import.meta.url,
);
// Respaldo estático (Plan B) por si no hay ni ClickHouse ni espejo local.
const BACKUP_URL = new URL(
  "../../../demo/seed-data/events-backup.json",
  import.meta.url,
);

function readJson(url: URL): EventRow[] {
  try {
    return JSON.parse(readFileSync(url, "utf8")) as EventRow[];
  } catch {
    return [];
  }
}

function fallback(error?: string): EventsResult {
  const live = readJson(LIVE_URL);
  if (live.length) return { source: "local", events: live, error };
  return { source: "backup", events: readJson(BACKUP_URL), error };
}

/** Lee los eventos de ClickHouse vía HTTP; cae a espejo local o respaldo si falla. */
export async function fetchEvents(limit = 200): Promise<EventsResult> {
  const base = process.env.CLICKHOUSE_URL;
  if (!base) {
    return fallback("CLICKHOUSE_URL no configurado");
  }

  const sql = `SELECT ts, kind, payload FROM events ORDER BY ts DESC LIMIT ${limit} FORMAT JSON`;
  const sep = base.includes("?") ? "&" : "?";
  const url = `${base}${sep}query=${encodeURIComponent(sql)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data?: EventRow[] };
    return { source: "clickhouse", events: data.data ?? [] };
  } catch (e) {
    return fallback((e as Error).message);
  }
}
