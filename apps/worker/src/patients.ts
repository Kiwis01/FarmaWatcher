import { readFileSync } from "node:fs";

export interface Patient {
  id: string;
  name: string;
  drugs: string[];
}

const PATIENTS_URL = new URL(
  "../../../demo/seed-data/patients.json",
  import.meta.url,
);

/** Padrón sintético de pacientes (demo/seed-data). */
export function loadPatients(): Patient[] {
  return JSON.parse(readFileSync(PATIENTS_URL, "utf8")) as Patient[];
}
