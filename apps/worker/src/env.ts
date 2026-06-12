// Carga .env si existe (Node >= 20.6 trae process.loadEnvFile nativo, sin dependencias).
// Si no hay .env, se usan las variables del entorno (Render, CI, etc.).
export function loadEnv(): void {
  const load = (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  try {
    load?.();
  } catch {
    /* sin archivo .env: continuar con process.env */
  }
}
