import { Composio } from '@composio/core';
import type { Alert, PostAlert } from '@farmacovigia/shared';

// === Contrato B → A: postAlert ===
// Publica una alerta vía Composio (Slack por defecto, Gmail opcional).
// Plan B en vivo: si DRY_RUN=true o Composio falla, imprime en consola y sigue.

const DRY_RUN = process.env.DRY_RUN === 'true';
const USER_ID = process.env.COMPOSIO_USER_ID || 'default';
const SLACK_CHANNEL = process.env.COMPOSIO_SLACK_CHANNEL || '#general';
const GMAIL_TO = process.env.COMPOSIO_GMAIL_TO || '';

let _composio: Composio | null = null;
function composio(): Composio {
  if (!_composio) {
    _composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  }
  return _composio;
}

function renderConsole(alert: Alert): void {
  const prov = alert.provenance.map((p) => `  - ${p.url}`).join('\n');
  console.log(
    `\n📣 [postAlert:${alert.channel}] ${alert.title}\n${alert.body}\n` +
      (prov ? `Fuentes:\n${prov}\n` : ''),
  );
}

interface ExecResult {
  data: Record<string, unknown>;
  error: string | null;
  successful: boolean;
}

async function sendSlack(alert: Alert): Promise<ExecResult> {
  const text =
    `*${alert.title}*\n${alert.body}` +
    (alert.provenance.length
      ? `\n\nFuentes:\n${alert.provenance.map((p) => `• ${p.url}`).join('\n')}`
      : '');
  return composio().tools.execute('SLACK_SEND_MESSAGE', {
    userId: USER_ID,
    arguments: { channel: SLACK_CHANNEL, message: text },
  }) as Promise<ExecResult>;
}

async function sendGmail(alert: Alert): Promise<ExecResult> {
  const to = GMAIL_TO;
  if (!to) throw new Error('COMPOSIO_GMAIL_TO no configurado');
  const body =
    `${alert.body}\n\n` +
    (alert.provenance.length
      ? `Fuentes:\n${alert.provenance.map((p) => p.url).join('\n')}`
      : '');
  return composio().tools.execute('GMAIL_SEND_EMAIL', {
    userId: USER_ID,
    arguments: { recipient_email: to, subject: alert.title, body },
  }) as Promise<ExecResult>;
}

// Intenta extraer un id útil del payload sin romper si el shape cambia.
function extractRef(res: ExecResult, channel: string): string {
  const d = res?.data ?? {};
  const id = (d.ts as string) || (d.id as string) || (d.messageId as string);
  return id ? `${channel}:${id}` : `${channel}:ok`;
}

export const postAlert: PostAlert = async (alert: Alert) => {
  if (DRY_RUN) {
    renderConsole(alert);
    return { ok: true, ref: `dry-run:${alert.channel}` };
  }
  try {
    const res =
      alert.channel === 'gmail' ? await sendGmail(alert) : await sendSlack(alert);
    if (res.successful === false) {
      console.error(`[postAlert] Composio respondió error:`, res.error);
      renderConsole(alert);
      return { ok: false, ref: `error:${res.error ?? 'unknown'}` };
    }
    return { ok: true, ref: extractRef(res, alert.channel) };
  } catch (err) {
    // Fallback en vivo: nunca tumbar la demo por una integración externa.
    console.error(`[postAlert] Composio falló, fallback a consola:`, err);
    renderConsole(alert);
    return { ok: false, ref: `error:${String((err as Error)?.message ?? err)}` };
  }
};

export default postAlert;
