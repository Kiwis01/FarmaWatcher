import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkDrugSafety } from "@farmavigia/sources";
import { postAlert } from "@farmavigia/notifier";
import type { Alert } from "@farmavigia/shared";
import type { Patient } from "./registry";

// Alerta inmediata al dar de alta un paciente con fármaco en recall ("Add anyway"):
// el mismo pipeline del worker (openFDA -> boletín -> Slack) sin esperar su pasada.
// El estado se comparte con el worker vía read-merge-write sobre los mismos
// archivos espejo (sin cachés en memoria, para que dos procesos no se pisen).

const LIVE_PATH = fileURLToPath(
  new URL("../../../demo/seed-data/events-live.json", import.meta.url),
);
const SENT_PATH = fileURLToPath(
  new URL("../../../demo/seed-data/alerts-sent.json", import.meta.url),
);
const MAX_ROWS = 500;

type EventKind = "recall_detected" | "patient_matched" | "bulletin_generated" | "alert_sent";

interface Row {
  ts: string;
  kind: string;
  payload: string;
}

function nowDateTime(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

async function logClickHouse(row: Row): Promise<void> {
  const base = process.env.CLICKHOUSE_URL;
  if (!base) return;
  const sep = base.includes("?") ? "&" : "?";
  const url = `${base}${sep}query=${encodeURIComponent("INSERT INTO events FORMAT JSONEachRow")}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`${res.status}`);
  } catch (e) {
    console.warn(`[instant-alert] ClickHouse write failed (${(e as Error).message})`);
  }
}

async function recordEvent(kind: EventKind, payload: unknown): Promise<void> {
  const row: Row = { ts: nowDateTime(), kind, payload: JSON.stringify(payload) };
  await logClickHouse(row);
  let rows: Row[];
  try {
    rows = JSON.parse(readFileSync(LIVE_PATH, "utf8")) as Row[];
  } catch {
    rows = [];
  }
  rows.push(row);
  if (rows.length > MAX_ROWS) rows.splice(0, rows.length - MAX_ROWS);
  try {
    writeFileSync(LIVE_PATH, JSON.stringify(rows, null, 2));
  } catch {
    /* el espejo local es best-effort */
  }
}

function markAlerted(keys: string[]): void {
  let sent: string[];
  try {
    sent = JSON.parse(readFileSync(SENT_PATH, "utf8")) as string[];
  } catch {
    sent = [];
  }
  const set = new Set(sent);
  for (const k of keys) set.add(k);
  writeFileSync(SENT_PATH, JSON.stringify([...set].sort(), null, 2) + "\n");
}

export interface InstantAlertResult {
  alerted: boolean;
  ok?: boolean;
  ref?: string;
  flaggedDrugs?: string[];
  error?: string;
}

/**
 * Corre el pipeline del worker para un solo paciente recién dado de alta.
 * Devuelve qué pasó para que la UI lo cuente ("alert sent to Slack ✓").
 */
export async function alertNewPatient(patient: Patient): Promise<InstantAlertResult> {
  const report = await checkDrugSafety({ patientId: patient.id, drugs: patient.drugs });
  const flagged = report.drugs.filter((d) => d.activeRecalls.length > 0);
  if (flagged.length === 0) return { alerted: false };

  const keys: string[] = [];
  for (const drug of flagged) {
    for (const recall of drug.activeRecalls) {
      keys.push(`${patient.id}:${recall.recallId}`);
      await recordEvent("recall_detected", {
        patientId: patient.id,
        drug: drug.input,
        recallId: recall.recallId,
        classification: recall.classification,
        reason: recall.reason,
        status: recall.status,
        sourceUrl: recall.sourceUrl,
      });
    }
  }

  await recordEvent("patient_matched", {
    patientId: patient.id,
    name: patient.name,
    drugs: flagged.map((d) => d.input),
  });

  await recordEvent("bulletin_generated", {
    patientId: patient.id,
    chars: report.bulletin.length,
    bulletin: report.bulletin,
  });

  const alert: Alert = {
    title: `⚠️ Drug recall affects ${patient.name}`,
    body: `${report.bulletin}\n\n${report.disclaimer}`,
    channel: "slack",
    provenance: report.sources.map((url) => ({ url })),
  };
  const res = await postAlert(alert);

  await recordEvent("alert_sent", {
    patientId: patient.id,
    channel: alert.channel,
    ok: res.ok,
    ref: res.ref,
  });

  // Igual que el worker: solo marcar si llegó de verdad (dry-run no cuenta),
  // para que la pasada continua reintente envíos fallidos.
  if (res.ok && !res.ref.startsWith("dry-run")) markAlerted(keys);

  return { alerted: true, ok: res.ok, ref: res.ref, flaggedDrugs: flagged.map((d) => d.input) };
}
