// Carga .env si existe (Node >= 20.6, sin dependencias). Si no, usa process.env (Render/CI).
export function loadEnv(): void {
  const load = (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  try {
    load?.();
  } catch {
    /* sin .env: continuar con process.env */
  }
}
