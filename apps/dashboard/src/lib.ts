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
  reason?: string;
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
  recall_detected: { label: "Retiro detectado en openFDA", code: "Retiro", cls: "k-recall" },
  patient_matched: { label: "Paciente que toma un fármaco retirado", code: "Paciente", cls: "k-patient" },
  bulletin_generated: { label: "Boletín en español escrito por Claude", code: "Boletín", cls: "k-bulletin" },
  alert_sent: { label: "Alerta enviada al paciente", code: "Alerta", cls: "k-alert" },
};

// Severidad FDA explicada en palabras de a pie. La fuente de verdad del "qué significa".
export const CLASS_META: Record<"I" | "II" | "III", { name: string; risk: string; def: string }> = {
  I: {
    name: "Clase I",
    risk: "riesgo grave",
    def: "Hay probabilidad razonable de que cause un daño serio a la salud, o la muerte.",
  },
  II: {
    name: "Clase II",
    risk: "riesgo moderado",
    def: "Puede causar un daño temporal o reversible; un daño serio es improbable.",
  },
  III: {
    name: "Clase III",
    risk: "riesgo bajo",
    def: "Es improbable que cause daño; incumple alguna norma de la FDA.",
  },
};

/** "Class II" | "II" -> "II" (acepta ambas formas, payload y openFDA). */
export function classOf(c?: string): "I" | "II" | "III" {
  const s = c ?? "";
  if (/III/i.test(s)) return "III";
  if (/II/i.test(s)) return "II";
  return "I";
}

export function parse(p: string): EventPayload {
  try {
    const v = typeof p === "string" ? JSON.parse(p) : p;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as EventPayload) : {};
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
  const r = await fetch("/api/events", {
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error("API " + r.status);
  return (await r.json()) as EventsResult;
}

/* ── Detalle de recall (dossier openFDA) ─────────────────────────────── */

export interface RecallDetail {
  recall_number: string;
  classification?: string;
  status?: string;
  reason_for_recall?: string;
  product_description?: string;
  recalling_firm?: string;
  city?: string;
  state?: string;
  country?: string;
  voluntary_mandated?: string;
  initial_firm_notification?: string;
  distribution_pattern?: string;
  product_quantity?: string;
  recall_initiation_date?: string;
  center_classification_date?: string;
  report_date?: string;
  code_info?: string;
}

export interface RecallDetailResult {
  source: "seed" | "openfda";
  record: RecallDetail;
}

export type DetailState =
  | { status: "loading" }
  | { status: "ready"; source: "seed" | "openfda"; record: RecallDetail }
  | { status: "none" };

const detailCache = new Map<string, Promise<RecallDetailResult | null>>();

/** Pide el dossier al server (fixture local u openFDA en vivo). null = sin detalle. */
export function fetchRecallDetail(id: string): Promise<RecallDetailResult | null> {
  const hit = detailCache.get(id);
  if (hit) return hit;
  const p = fetch(`/api/recall/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(10000),
  })
    .then((r) => (r.ok ? (r.json() as Promise<RecallDetailResult>) : null))
    .catch(() => null)
    .then((res) => {
      // No cachear fallas: si vuelve la red, el próximo intento reintenta.
      if (!res) detailCache.delete(id);
      return res;
    });
  detailCache.set(id, p);
  return p;
}

/* ── Traducciones: del dato crudo de la FDA a español de a pie ───────── */

/** Limpia valores tipo "N/A" / "unknown" / vacío -> null. */
export function clean(v?: string): string | null {
  const s = (v ?? "").trim();
  if (!s || /^(n\/?a|unknown|none)\.?$/i.test(s)) return null;
  return s;
}

export function statusEs(s?: string): string | null {
  const v = clean(s);
  if (!v) return null;
  const map: Record<string, string> = {
    ongoing: "En curso",
    completed: "Completado",
    terminated: "Concluido",
    pending: "Pendiente",
  };
  return map[v.toLowerCase()] ?? v;
}

export function statusTitle(s?: string): string | undefined {
  if ((s ?? "").toLowerCase() === "ongoing") {
    return "El retiro sigue activo: aún puede haber producto afectado en circulación.";
  }
  return undefined;
}

export function voluntaryEs(v?: string): string | null {
  const s = clean(v);
  if (!s) return null;
  if (/mandated|ordered/i.test(s)) return "Ordenado por la FDA";
  if (/voluntary/i.test(s)) return "Voluntario, iniciado por la empresa";
  return s;
}

export function notificationEs(n?: string): string | null {
  const s = clean(n);
  if (!s) return null;
  if (/two or more/i.test(s)) return "avisó por varios medios";
  const map: Record<string, string> = {
    letter: "avisó por carta",
    "press release": "avisó por comunicado de prensa",
    "e-mail": "avisó por correo electrónico",
    email: "avisó por correo electrónico",
    telephone: "avisó por teléfono",
    fax: "avisó por fax",
    visit: "avisó en persona",
  };
  return map[s.toLowerCase()] ?? `avisó por ${s}`;
}

export function countryEs(c?: string): string | null {
  const s = clean(c);
  if (!s) return null;
  const map: Record<string, string> = {
    "united states": "EUA",
    india: "India",
    israel: "Israel",
    canada: "Canadá",
    china: "China",
    germany: "Alemania",
    switzerland: "Suiza",
    japan: "Japón",
    "united kingdom": "Reino Unido",
  };
  return map[s.toLowerCase()] ?? s;
}

/** Ciudad/estado/país del fabricante -> "North Wales, PA (EUA)". */
export function firmPlace(d: RecallDetail): string | null {
  const parts = [clean(d.city), clean(d.state)].filter(Boolean).join(", ");
  const country = countryEs(d.country);
  if (parts && country) return `${parts} (${country})`;
  return parts || country;
}

/** "20181127" -> "27 nov 2018" (es-MX, sin sorpresas de zona horaria). */
export function fmtFdaDate(s?: string): string | null {
  const v = clean(s);
  if (!v) return null;
  if (!/^\d{8}$/.test(v)) return v;
  const d = new Date(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8)));
  return d
    .toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })
    .replace(/\./g, "");
}

/** "120,394 bottles" -> "120,394 frascos". Si no reconoce la unidad, regresa el crudo. */
export function quantityEs(q?: string): string | null {
  const s = clean(q);
  if (!s) return null;
  const m = /^([\d.,]+)\s+(.+)$/.exec(s);
  if (!m) return s;
  const units: Record<string, string> = {
    bottles: "frascos",
    bottle: "frascos",
    tablets: "tabletas",
    tablet: "tabletas",
    capsules: "cápsulas",
    cartons: "cajas",
    carton: "cajas",
    cases: "cajas",
    bags: "bolsas",
    vials: "viales",
    units: "unidades",
    packages: "paquetes",
    packets: "sobres",
    pouches: "sobres",
    tubes: "tubos",
    syringes: "jeringas",
    kits: "kits",
    blisters: "blísteres",
  };
  const unit = units[m[2].trim().toLowerCase()];
  return unit ? `${m[1]} ${unit}` : s;
}

/** Patrón de distribución en una frase corta; el texto crudo va en title=. */
export function distributionEs(d?: string): string | null {
  const s = clean(d);
  if (!s) return null;
  if (/nationwide/i.test(s)) {
    return /puerto rico/i.test(s)
      ? "Todo EUA, incluido Puerto Rico"
      : "Todo EUA (distribución nacional)";
  }
  if (/^[A-Z]{2}(?:\s*,\s*[A-Z]{2})*\.?$/.test(s)) {
    return `Solo algunos estados de EUA: ${s.replace(/\.$/, "")}`;
  }
  return s;
}

/**
 * El "en pocas palabras" del motivo: mapea las causas más comunes de recall
 * a una frase en español. Conservador: si no reconoce el patrón, no inventa.
 */
export function reasonGist(r?: string): string | null {
  const s = clean(r);
  if (!s) return null;
  if (/N-?nitros|NDMA|NDEA|NMBA/i.test(s)) {
    return "Se detectó una impureza del grupo de las nitrosaminas, asociada a riesgo de cáncer si la exposición es prolongada.";
  }
  if (/declared strength/i.test(s)) {
    return "La dosis impresa en el empaque puede no ser la real; hay que verificar caja y blíster.";
  }
  if (/label/i.test(s)) {
    return "Error de etiquetado: lo impreso en el empaque puede no corresponder al contenido.";
  }
  if (/salmonella/i.test(s)) {
    return "Contaminación con salmonela detectada por la FDA.";
  }
  if (/microb/i.test(s)) {
    return "Posible contaminación microbiológica del producto.";
  }
  if (/foreign (tablet|capsule|substance|material)/i.test(s)) {
    return "Se encontró producto o material ajeno dentro del empaque.";
  }
  if (/steril/i.test(s)) {
    return "No se puede garantizar que el producto sea estéril.";
  }
  if (/subpotent|superpotent|potency/i.test(s)) {
    return "La concentración del fármaco está fuera de lo especificado.";
  }
  if (/dissolution/i.test(s)) {
    return "Las tabletas no se disuelven como deben, lo que altera la dosis recibida.";
  }
  if (/stability/i.test(s)) {
    return "El producto falló pruebas de estabilidad (no dura lo que promete la caducidad).";
  }
  if (/cgmp/i.test(s)) {
    return "La FDA encontró desviaciones de buenas prácticas de manufactura.";
  }
  return null;
}

/** Extrae lotes y códigos NDC del campo libre code_info. */
export function parseCodeInfo(s?: string): { lots: string[]; ndcs: string[] } {
  const text = clean(s) ?? "";
  const ndcs = [
    ...new Set([...text.matchAll(/\b\d{4,5}-\d{3,4}(?:-\d{1,2})?\b/g)].map((m) => m[0])),
  ];
  let rest = text;
  for (const n of ndcs) rest = rest.split(n).join(" ");
  const lots = [
    ...new Set(
      [...rest.matchAll(/\b[A-Z0-9]{6,10}\b/g)]
        .map((m) => m[0])
        .filter((t) => (t.match(/\d/g)?.length ?? 0) >= 4),
    ),
  ];
  return { lots, ndcs };
}

export function channelEs(c?: string): string {
  const map: Record<string, string> = { slack: "Slack", gmail: "Gmail" };
  return map[(c ?? "").toLowerCase()] ?? (c ?? "");
}

/** Palabras de un boletín (preferimos contar el texto; chars/6 como aproximación). */
export function wordsOf(bulletin?: string, chars?: number): number {
  if (bulletin?.trim()) return bulletin.trim().split(/\s+/).length;
  if (chars) return Math.round(chars / 6);
  return 0;
}
