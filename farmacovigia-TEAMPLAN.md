# FarmacoVigía — Plan de trabajo para 2 personas

> Principio: dividir por la **costura con menos archivos compartidos**. Persona A construye el *agente clínico* (worker + dominio). Persona B construye los *rieles de dinero* (API x402 + publicación + deploy). Se tocan solo a través de 2 funciones y 1 esquema de ClickHouse, congelados en el commit inicial.

## Quién es quién

| | Rama | Misión | Perfil ideal |
|---|---|---|---|
| **Persona A** | `feat/agente-clinico` | El agente que vigila, cruza y actúa | Quien conoce el dominio salud/NestJS (Carlos) |
| **Persona B** | `feat/rieles-dinero` | Que el dinero se mueva y el demo viva en una URL | Quien no le tema a wallets/deploy |

*(Si tu compañero sabe crypto, intercambien.)*

## Mapa de propiedad — nadie edita las carpetas del otro

| Carpeta | Dueño |
|---|---|
| `apps/worker/`, `packages/rxnorm/`, `packages/sources/`, `airbyte/`, `analytics/schema.sql`, `demo/seed-data/` | **A** |
| `apps/api/`, `packages/publisher/`, `demo/buyer/`, `analytics/dashboard/`, `render.yaml` | **B** |
| `packages/shared/` (tipos), `.env.example`, `package.json` raíz, CI | **Congelado en M0** — cambios solo de a dos, commit directo a `main` |

Cada package tiene su propio `package.json` (workspaces): así las dependencias nuevas de A y B no chocan en el mismo archivo. El lockfile lo regenera quien mergea segundo en cada punto M.

## El contrato (se commitea a `main` en M0, antes de branchear)

Cada quien consume **una** función del otro; ambas nacen como mock para no bloquearse:

```ts
// packages/shared/src/types.ts
export interface SafetyCheckRequest { drugs: string[] }
export interface RecallHit { recallId: string; classification: 'I'|'II'|'III'; reason: string; status: string; sourceUrl: string }
export interface InteractionHit { pair: [string, string]; severity: string; description: string; sourceUrl: string }
export interface SafetyReport {
  drugs: { input: string; rxcui: string | null; activeRecalls: RecallHit[] }[]
  interactions: InteractionHit[]
  sources: string[]            // URLs de provenance
  generatedAt: string
  disclaimer: string
}
export interface Bulletin { slug: string; title: string; body: string; tags: string[]; provenance: { url: string; publishedAt: string }[] }

// Contrato A → B (A la implementa en packages/rxnorm+sources; B la consume en apps/api)
export type CheckDrugSafety = (req: SafetyCheckRequest) => Promise<SafetyReport>

// Contrato B → A (B la implementa en packages/publisher; A la consume en apps/worker)
export type PublishBulletin = (b: Bulletin) => Promise<{ url: string }>
```

```sql
-- analytics/schema.sql (dueño A; B solo lee para el dashboard)
CREATE TABLE events (
  ts DateTime, kind LowCardinality(String), payload String
) ENGINE = MergeTree ORDER BY (kind, ts);
-- kinds: recall_detected | patient_matched | alert_sent | bulletin_published | paid_request

CREATE TABLE paid_requests (
  ts DateTime, route String, price_usdc Decimal(10,6),
  payer_wallet String, tx_hash String, latency_ms UInt32
) ENGINE = MergeTree ORDER BY ts;
```

`.env.example` completo desde M0 (aunque los valores lleguen después): `CLICKHOUSE_URL`, `CDP_API_KEY_ID/SECRET`, `WALLET_ADDRESS`, `SENSO_API_KEY`, `COMPOSIO_API_KEY`, `TWILIO_*`, `AWS_*`, `OPENFDA_BASE`, y `LLM_PROVIDER` + `LLM_BASE_URL` + `LLM_API_KEY`.

**Regla de diseño del cliente LLM:** A escribe UNA función `llmComplete(model, prompt)` OpenAI-compatible, parametrizada por `LLM_BASE_URL`/`LLM_API_KEY`. El default es `LLM_PROVIDER=truefoundry`: TODA la inferencia (Claude para boletines, Pioneer para clasificar) pasa por el AI Gateway con una virtual key que emite B — el código nunca toca keys de proveedores. Cambiar de modelo = cambiar el string `model`. Fallback de emergencia si el gateway falla en vivo: apuntar `LLM_BASE_URL` a un proveedor directo (mismo código).

## Cadencia de merges — 5 puntos, no un big-bang al final

| Punto | Hora | Qué se mergea | Criterio de aceptación (si no pasa, no se mergea) |
|---|---|---|---|
| **M0** | h0 | Scaffold + contrato (juntos, en `main`) | `npm run build` verde; tipos y DDL commiteados; ambos branchean |
| **M1** | ~h6 | Primeros avances de ambos | Build verde con las DOS ramas en main; B muestra 402→pago testnet contra endpoint **stub** y entrega la virtual key de TrueFoundry probada con un completion; A muestra `getRxcui()` + cliente openFDA con test |
| **M2** | ~h14 | Worker v1 (A) + publisher real (B) | El worker detecta un recall sembrado y publica **de verdad** en cited.md vía `publishBulletin` de B; servicio de B listado en agentic.market |
| **M3** | ~h22 | La integración grande | B reemplaza su mock por el `checkDrugSafety` real de A → un buyer paga $0.01 y recibe el reporte real; el WhatsApp dispara. **End-to-end completo** |
| **M4** | h30 | Freeze | Solo `main` de aquí en adelante: seeds, guion, video de respaldo, README. Stretch (Pioneer/OpenUI/Guild) solo si M3 quedó sólido |

## Reparto hora por hora

**Persona A — `feat/agente-clinico`**

| Horas | Tarea |
|---|---|
| 0–1 | (juntos) M0 + probar destino ClickHouse de Airbyte |
| 1–5 | `packages/rxnorm` (getRxcui, checkInteractions) + `packages/sources` (cliente openFDA) |
| 5–10 | `apps/worker`: poll openFDA → RxCUI → cruce vs medications sintéticas → evento a ClickHouse |
| 10–14 | Boletín (Claude) y clasificador de severidad (Pioneer), ambos vía `llmComplete()` → gateway TrueFoundry + WhatsApp Twilio + llamar `publishBulletin` (mock→real en M2) |
| 14–18 | Composio (Slack/Gmail) + Airbyte: Postgres→ClickHouse |
| 18–22 | Implementación final de `checkDrugSafety` para B + fixture de recall sembrado (demo determinista) |
| 22–30 | Conector openFDA en Airbyte Builder (stretch) · feedback útil/no-útil del médico → señal de entrenamiento a Pioneer (stretch) · seeds y pulido |

**Persona B — `feat/rieles-dinero`**

| Horas | Tarea |
|---|---|
| 0–1 | (juntos) M0 + wallet `npx awal` + faucet USDC Base Sepolia |
| 1–4 | `apps/api`: `@x402/express` sobre endpoint stub que devuelve un `SafetyReport` falso · sandbox TrueFoundry: registrar providers (Claude + Pioneer con sus créditos) y emitir la virtual key para A (entregar en M1) |
| 4–6 | CDP Facilitator + `declareDiscoveryExtension` + self-call pagado → listado en agentic.market |
| 6–10 | `packages/publisher`: handle en cited.md (CLI Senso) + publicar 2 boletines a mano |
| 10–14 | `demo/buyer`: script comprador `@x402/axios` + verificación en Basescan |
| 14–18 | Dashboard de revenue sobre ClickHouse (`paid_requests`, `events`) + tesorería vía Composio: el agente lee su wallet CDP (toolkit Coinbase, `COINBASE_LIST_WALLETS`) y postea "hoy gané $X USDC" al Slack — probar las API keys de CDP en Composio temprano |
| 18–22 | `render.yaml` (web service + cron) y deploy; en M3 conectar el `checkDrugSafety` real |
| 22–30 | OpenUI para el reporte (stretch) · MCP Gateway de TrueFoundry: registrar el MCP de Composio para que los tool calls también queden gobernados con RBAC y auditoría (stretch) · Guild (stretch) |

## Reglas de git (para no pelearse en el merge)

1. Las dos ramas salen de `main` en M0 y **viven hasta el final** — pero mergean a `main` en CADA punto M, no solo al final. Merges pequeños = conflictos pequeños.
2. Después de cada M, ambos hacen `git merge main` en su rama (o rebase, pero elijan UNO los dos).
3. PR cruzado en cada M: el otro revisa máximo 10 minutos. No es code review de producción, es "¿rompes algo mío?".
4. Conflicto esperado único: lockfile raíz → lo regenera quien mergea segundo (`rm package-lock.json && npm install`).
5. Si necesitas algo de la carpeta del otro: NO lo edites — pídelo o agrégalo a `packages/shared` juntos.
6. Mensajes de commit con prefijo de área (`worker:`, `api:`, `publisher:`...) para que el log cuente la historia en el repo público que ven los jueces.
