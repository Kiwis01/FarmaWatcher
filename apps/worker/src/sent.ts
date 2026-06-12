import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Registro de alertas ya enviadas (clave paciente+retiro). Evita que el modo
// continuo repita la misma alerta en Slack en cada pasada. Espejo local
// simple, igual que events-live.json.
const SENT_PATH = fileURLToPath(
  new URL("../../../demo/seed-data/alerts-sent.json", import.meta.url),
);

let sent: Set<string> | null = null;

function load(): Set<string> {
  if (sent) return sent;
  try {
    sent = new Set(JSON.parse(readFileSync(SENT_PATH, "utf8")) as string[]);
  } catch {
    sent = new Set();
  }
  return sent;
}

export function alertKey(patientId: string, recallId: string): string {
  return `${patientId}:${recallId}`;
}

export function wasAlerted(key: string): boolean {
  return load().has(key);
}

export function markAlerted(keys: string[]): void {
  const set = load();
  for (const key of keys) set.add(key);
  writeFileSync(SENT_PATH, JSON.stringify([...set], null, 2) + "\n");
}
