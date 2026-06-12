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

export type EventPayload = Record<string, unknown> & {
  drug?: string;
  recallId?: string;
  classification?: string;
  status?: string;
  sourceUrl?: string;
  patientId?: string;
  name?: string;
  drugs?: string[];
  chars?: number;
  bulletin?: string;
  channel?: string;
  ok?: boolean;
  ref?: string;
};

export const KIND: Record<string, { label: string; code: string; cls: string }> = {
  recall_detected: { label: "Recall detectado", code: "Recall", cls: "k-recall" },
  patient_matched: { label: "Paciente afectado", code: "Paciente", cls: "k-patient" },
  bulletin_generated: { label: "Boletín generado", code: "Boletín", cls: "k-bulletin" },
  alert_sent: { label: "Alerta enviada", code: "Alerta", cls: "k-alert" },
};

export function parse(p: string): EventPayload {
  try {
    return typeof p === "string" ? (JSON.parse(p) as EventPayload) : (p as EventPayload);
  } catch {
    return {};
  }
}

export function toDate(ts: string): Date {
  const s = String(ts);
  const d = new Date(s.replace(" ", "T") + (s.includes("Z") ? "" : "Z"));
  return isNaN(d.getTime()) ? new Date(ts) : d;
}

export function hms(d: Date): string {
  return d.toLocaleTimeString("es-MX", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function rel(d: Date): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 0) return "ahora";
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return d.toLocaleDateString("es-MX");
}

export async function fetchEvents(): Promise<EventsResult> {
  const r = await fetch("/api/events", { cache: "no-store" });
  if (!r.ok) throw new Error("API " + r.status);
  return (await r.json()) as EventsResult;
}
