# FarmacoVigía

Agente de farmacovigilancia que vigila los retiros (recalls) de medicamentos de la FDA
(openFDA), los cruza contra un padrón sintético de pacientes y, cuando un paciente toma un
fármaco retirado, genera un boletín en español con Claude (vía AI Gateway de TrueFoundry),
empuja la alerta a Slack/Gmail (Composio) y registra cada evento en ClickHouse.

Demo de 2 horas, 2 personas. Ver [farmacovigia-TEAMPLAN.md](farmacovigia-TEAMPLAN.md).

## Estructura

```
packages/shared/    Tipos del contrato congelado (M0) — compartido
analytics/schema.sql  DDL de la tabla `events` en ClickHouse (dueño: A)
packages/sources/   Persona A — openFDA + match + llmComplete + checkDrugSafety
apps/worker/        Persona A — agente: cruza recalls vs pacientes, alerta y loggea
apps/dashboard/     Persona A — frontend React (Vite) + server que lee events de ClickHouse
demo/seed-data/     Persona A — fixture determinista (pacientes + recalls + respaldo)
apps/api/           Persona B — endpoint /check (consume checkDrugSafety)
packages/notifier/  Persona B — postAlert vía Composio
render.yaml         Persona B — deploy del backend
```

## Quickstart (Persona A)

```bash
npm install
cp .env.example .env      # rellena LLM_*, CLICKHOUSE_URL si los tienes

# Build / typecheck de todo el monorepo
npm run build

# Correr el agente
npm run worker

# Dashboard (React): build + servir en http://localhost:3000
npm run dashboard:build
npm run dashboard
```

Flags de demo (en `.env`):

- `USE_SEED=1` — usa el fixture determinista (no depende de openFDA en vivo).
- `DRY_RUN=1` — `postAlert` imprime en consola en vez de enviar (default).

Sin `LLM_*` configurado, el boletín cae a una plantilla en español (el demo nunca se rompe).
