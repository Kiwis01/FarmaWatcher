import type {
  CheckDrugSafety,
  SafetyCheckRequest,
  SafetyReport,
} from "@farmavigia/shared";
import { fetchRecalls, matchSeed, type OpenFdaRecall } from "./openfda";
import { isActive, toRecallHit, severityRank, dedupeByRecall } from "./match";
import { mapClassification } from "./match";
import { llmComplete } from "./llm";

const DISCLAIMER =
  "Información orientativa de farmacovigilancia generada automáticamente a partir de datos públicos de la FDA (openFDA). No sustituye el juicio clínico ni la consulta con un profesional de la salud.";

function useSeed(): boolean {
  const v = process.env.USE_SEED;
  return v === "1" || v === "true";
}

/** Obtiene recalls para un fármaco: seed forzado, o en vivo con fallback a seed si falla. */
async function recallsForDrug(drug: string): Promise<OpenFdaRecall[]> {
  if (useSeed()) return matchSeed(drug);
  try {
    return await fetchRecalls(drug);
  } catch {
    // openFDA caído en vivo -> no rompemos el demo, usamos el fixture.
    return matchSeed(drug);
  }
}

interface FlaggedRaw {
  input: string;
  records: OpenFdaRecall[];
}

export const checkDrugSafety: CheckDrugSafety = async (req) => {
  const sources = new Set<string>();
  const drugs: SafetyReport["drugs"] = [];
  const raw: FlaggedRaw[] = [];

  for (const input of req.drugs) {
    const records = dedupeByRecall(await recallsForDrug(input)).filter(isActive);
    const activeRecalls = records
      .map(toRecallHit)
      .sort((a, b) => severityRank(a.classification) - severityRank(b.classification));
    activeRecalls.forEach((h) => sources.add(h.sourceUrl));
    drugs.push({ input, activeRecalls });
    if (records.length) raw.push({ input, records });
  }

  const bulletin = await buildBulletin(req, drugs, raw);

  return {
    drugs,
    bulletin,
    sources: [...sources],
    generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
};

function fmtDate(d?: string): string {
  if (!d) return "";
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function oneFact(r: OpenFdaRecall): string {
  const cls = mapClassification(r.classification);
  const date = fmtDate(r.recall_initiation_date);
  const firm = r.recalling_firm ? `, fabricante ${r.recalling_firm}` : "";
  const when = date ? `, inició ${date}` : "";
  const lot = r.code_info ? `, lote(s): ${truncate(r.code_info.replace(/\s+/g, " "), 70)}` : "";
  return `recall ${r.recall_number} (Clase ${cls}, ${r.status}${when}${firm}) — ${r.reason_for_recall}${lot}`;
}

async function buildBulletin(
  req: SafetyCheckRequest,
  drugs: SafetyReport["drugs"],
  raw: FlaggedRaw[],
): Promise<string> {
  if (raw.length === 0) {
    const who = req.patientId ? ` para el paciente ${req.patientId}` : "";
    return `No se detectaron retiros (recalls) activos de la FDA${who} en los medicamentos revisados: ${drugs
      .map((d) => d.input)
      .join(", ")}.`;
  }

  const facts = raw
    .map((d) => `- ${d.input}: ${d.records.map(oneFact).join("; ")}`)
    .join("\n");

  const model = process.env.LLM_MODEL ?? "claude-sonnet-4-6";
  const system =
    "Eres un asistente de farmacovigilancia. Escribes en español claro y empático, " +
    "para que un paciente sin formación médica entienda el riesgo y qué hacer. " +
    "No inventes datos: usa solo los recalls proporcionados. Sé breve.";
  const prompt =
    `Genera un boletín de alerta${req.patientId ? ` para el paciente ${req.patientId}` : ""}.\n` +
    `Medicamentos con retiros activos de la FDA:\n${facts}\n\n` +
    `El boletín debe: (1) explicar en 1-2 frases qué se retiró y por qué, ` +
    `(2) indicar la clase de riesgo (Clase I es la más grave), ` +
    `(3) si hay número de lote o fecha, mencionar que revise su empaque, ` +
    `(4) recomendar NO suspender el tratamiento por cuenta propia y consultar a su médico o farmacéutico. ` +
    `Máximo ~140 palabras. No incluyas disclaimer (se agrega aparte).`;

  try {
    return await llmComplete(model, prompt, { system });
  } catch {
    return templateBulletin(req, facts);
  }
}

function templateBulletin(req: SafetyCheckRequest, facts: string): string {
  const who = req.patientId ? ` (paciente ${req.patientId})` : "";
  return (
    `⚠️ Alerta de farmacovigilancia${who}\n` +
    `Se detectaron retiros (recalls) activos de la FDA en uno o más de tus medicamentos:\n` +
    `${facts}\n\n` +
    `Las Clases I/II indican un riesgo de salud relevante. ` +
    `Revisa el número de lote en tu empaque si se indica arriba. ` +
    `IMPORTANTE: no suspendas tu tratamiento por tu cuenta. ` +
    `Contacta a tu médico o farmacéutico para revisar tu lote y posibles alternativas.`
  );
}
