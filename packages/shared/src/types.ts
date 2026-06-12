// === CONTRATO CONGELADO (M0) ===
// Cambios SOLO de a dos y por commit directo a `main`.
// Persona A implementa CheckDrugSafety (packages/sources) y consume PostAlert (apps/worker).
// Persona B implementa PostAlert (packages/notifier vía Composio) y consume CheckDrugSafety (apps/api).

export interface SafetyCheckRequest {
  patientId?: string;
  drugs: string[];
}

export interface RecallHit {
  recallId: string;
  classification: "I" | "II" | "III";
  reason: string;
  status: string;
  sourceUrl: string;
}

export interface SafetyReport {
  drugs: { input: string; activeRecalls: RecallHit[] }[];
  bulletin: string; // texto en español generado por Claude vía TrueFoundry
  sources: string[]; // URLs de provenance (openFDA)
  generatedAt: string;
  disclaimer: string;
}

export interface Alert {
  title: string;
  body: string;
  channel: "slack" | "gmail";
  provenance: { url: string }[];
}

// Contrato A -> B (A la implementa en packages/sources; B la consume en apps/api)
export type CheckDrugSafety = (req: SafetyCheckRequest) => Promise<SafetyReport>;

// Contrato B -> A (B la implementa en packages/notifier vía Composio; A la consume en apps/worker)
export type PostAlert = (a: Alert) => Promise<{ ok: boolean; ref: string }>;

// Tipos de evento que se loggean a ClickHouse (tabla events)
export type EventKind =
  | "recall_detected"
  | "patient_matched"
  | "bulletin_generated"
  | "alert_sent";
