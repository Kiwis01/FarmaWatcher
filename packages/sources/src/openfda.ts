import { readFileSync } from "node:fs";
import { canonicalDrug, normalize } from "./synonyms";

// Forma (parcial) de un registro del endpoint openFDA "drug enforcement".
export interface OpenFdaRecall {
  recall_number: string;
  classification: string; // "Class I" | "Class II" | "Class III"
  reason_for_recall: string;
  status: string; // "Ongoing" | "Completed" | "Terminated"
  product_description: string;
  recall_initiation_date?: string; // "YYYYMMDD"
  recalling_firm?: string;
  code_info?: string; // lote(s) afectados
  distribution_pattern?: string;
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    substance_name?: string[];
  };
}

interface OpenFdaResponse {
  results?: OpenFdaRecall[];
}

const SEED_URL = new URL("../../../demo/seed-data/recalls.json", import.meta.url);

export function openFdaBase(): string {
  return (process.env.OPENFDA_BASE ?? "https://api.fda.gov").replace(/\/$/, "");
}

/** Recalls sembrados (fixture determinista para el demo, Plan B). */
export function loadSeedRecalls(): OpenFdaRecall[] {
  return JSON.parse(readFileSync(SEED_URL, "utf8")) as OpenFdaRecall[];
}

/** Filtra el fixture por nombre de fármaco (normalizado: sin acentos, ES->EN). */
export function matchSeed(drug: string): OpenFdaRecall[] {
  const q = normalize(canonicalDrug(drug));
  const hit = (s?: string) => !!s && normalize(s).includes(q);
  return loadSeedRecalls().filter(
    (r) =>
      hit(r.product_description) ||
      r.openfda?.generic_name?.some(hit) ||
      r.openfda?.brand_name?.some(hit) ||
      r.openfda?.substance_name?.some(hit),
  );
}

/** Consulta en vivo el endpoint drug enforcement de openFDA para un fármaco. */
export async function fetchRecalls(drug: string, limit = 5): Promise<OpenFdaRecall[]> {
  const v = encodeURIComponent(canonicalDrug(drug).toLowerCase());
  const search =
    `(openfda.generic_name:"${v}"+OR+openfda.brand_name:"${v}"` +
    `+OR+openfda.substance_name:"${v}"+OR+product_description:"${v}")`;
  // API key opcional: sin ella openFDA permite uso básico; con ella sube el rate limit.
  const key = process.env.OPENFDA_API_KEY;
  const auth = key ? `&api_key=${encodeURIComponent(key)}` : "";
  const url = `${openFdaBase()}/drug/enforcement.json?search=${search}&limit=${limit}${auth}`;
  const res = await fetch(url);
  // openFDA devuelve 404 cuando no hay coincidencias.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`openFDA ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as OpenFdaResponse;
  return data.results ?? [];
}

/** URL de provenance estable para un recall concreto. */
export function recallSourceUrl(recallNumber: string): string {
  return `${openFdaBase()}/drug/enforcement.json?search=recall_number:%22${encodeURIComponent(recallNumber)}%22`;
}
