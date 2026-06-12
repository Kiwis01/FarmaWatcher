import type {
  CheckDrugSafety,
  SafetyCheckRequest,
  SafetyReport,
} from "@farmavigia/shared";
import { fetchRecalls, matchSeed, type OpenFdaRecall } from "./openfda";
import { isActive, toRecallHit, severityRank, dedupeByRecall } from "./match";
import { mapClassification } from "./match";
import { llmPromptComplete } from "./llm";

const DISCLAIMER =
  "Automatically generated pharmacovigilance information based on public FDA (openFDA) data. It does not replace clinical judgment or consultation with a healthcare professional.";

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
  const firm = r.recalling_firm ? `, manufacturer ${r.recalling_firm}` : "";
  const when = date ? `, initiated ${date}` : "";
  const lot = r.code_info ? `, lot(s): ${truncate(r.code_info.replace(/\s+/g, " "), 70)}` : "";
  return `recall ${r.recall_number} (Class ${cls}, ${r.status}${when}${firm}) — ${r.reason_for_recall}${lot}`;
}

async function buildBulletin(
  req: SafetyCheckRequest,
  drugs: SafetyReport["drugs"],
  raw: FlaggedRaw[],
): Promise<string> {
  if (raw.length === 0) {
    const who = req.patientId ? ` for patient ${req.patientId}` : "";
    return `No active FDA recalls were detected${who} for the reviewed medications: ${drugs
      .map((d) => d.input)
      .join(", ")}.`;
  }

  const facts = raw
    .map((d) => `- ${d.input}: ${d.records.map(oneFact).join("; ")}`)
    .join("\n");

  const model = process.env.LLM_MODEL ?? "claude-sonnet-4-6";
  const promptFqn = process.env.LLM_PROMPT_FQN ?? "";

  try {
    // El prompt del boletín vive en el Prompt Registry de TrueFoundry
    // (LLM_PROMPT_FQN), no en el código. Variables: {{patient_id}}, {{facts}}.
    if (!promptFqn) throw new Error("LLM_PROMPT_FQN not configured");
    return await llmPromptComplete(
      promptFqn,
      { patient_id: req.patientId ?? "unknown", facts },
      { model },
    );
  } catch {
    return templateBulletin(req, facts);
  }
}

function templateBulletin(req: SafetyCheckRequest, facts: string): string {
  const who = req.patientId ? ` (patient ${req.patientId})` : "";
  return (
    `⚠️ Pharmacovigilance alert${who}\n` +
    `Active FDA recalls were detected for one or more of your medications:\n` +
    `${facts}\n\n` +
    `Class I/II recalls indicate a significant health risk. ` +
    `Check the lot number on your packaging if listed above. ` +
    `IMPORTANT: do not stop your treatment on your own. ` +
    `Contact your doctor or pharmacist to review your lot and possible alternatives.`
  );
}
