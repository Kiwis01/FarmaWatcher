import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { logEvent, type EventKind } from "./clickhouse";

// Espejo local de eventos: permite que el dashboard se vea "vivo" con datos reales
// SIN depender de ClickHouse (que aún no entrega Person B). Es un log rotativo.
const LIVE_PATH = fileURLToPath(
  new URL("../../../demo/seed-data/events-live.json", import.meta.url),
);
const MAX = 500;

interface Row {
  ts: string;
  kind: string;
  payload: string;
}

let buffer: Row[] | null = null;

function load(): Row[] {
  if (buffer) return buffer;
  try {
    buffer = JSON.parse(readFileSync(LIVE_PATH, "utf8")) as Row[];
  } catch {
    buffer = [];
  }
  return buffer;
}

function nowDateTime(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/** Registra un evento en ClickHouse (si está configurado) y en el espejo local. */
export async function recordEvent(kind: EventKind, payload: unknown): Promise<void> {
  await logEvent(kind, payload);

  const rows = load();
  rows.push({ ts: nowDateTime(), kind, payload: JSON.stringify(payload) });
  if (rows.length > MAX) rows.splice(0, rows.length - MAX);
  try {
    writeFileSync(LIVE_PATH, JSON.stringify(rows, null, 2));
  } catch {
    /* si no se puede escribir el espejo, no es fatal */
  }
}
