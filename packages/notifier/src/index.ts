import { Composio } from '@composio/core';
import type { Alert, PostAlert } from '@farmacovigia/shared';

// === Contrato B → A: postAlert ===
// Publica una alerta vía Composio usando Gmail.
// Plan B en vivo: si DRY_RUN=true o Composio falla, imprime en consola y sigue.
// Nota: el env se lee de forma perezosa (dentro de las funciones) porque este
// módulo se importa antes de que el consumidor cargue dotenv.

const dryRun = () => process.env.DRY_RUN === 'true';
const userId = () => process.env.COMPOSIO_USER_ID || 'default';
const gmailTo = () => process.env.COMPOSIO_GMAIL_TO || '';

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
    `\n📣 [postAlert:gmail] ${alert.title}\n${alert.body}\n` +
      (prov ? `Fuentes:\n${prov}\n` : ''),
  );
}

interface ExecResult {
  data: Record<string, unknown>;
  error: string | null;
  successful: boolean;
}

async function sendGmail(alert: Alert): Promise<ExecResult> {
  const to = gmailTo();
  if (!to) throw new Error('COMPOSIO_GMAIL_TO no configurado');
  const body =
    `${alert.body}\n\n` +
    (alert.provenance.length
      ? `Fuentes:\n${alert.provenance.map((p) => p.url).join('\n')}`
      : '');
  return composio().tools.execute('GMAIL_SEND_EMAIL', {
    userId: userId(),
    arguments: { recipient_email: to, subject: alert.title, body },
  }) as Promise<ExecResult>;
}

// Intenta extraer un id útil del payload sin romper si el shape cambia.
function extractRef(res: ExecResult): string {
  const d = res?.data ?? {};
  const id = (d.id as string) || (d.messageId as string) || (d.threadId as string);
  return id ? `gmail:${id}` : `gmail:ok`;
}

export const postAlert: PostAlert = async (alert: Alert) => {
  if (dryRun()) {
    renderConsole(alert);
    return { ok: true, ref: `dry-run:gmail` };
  }
  try {
    const res = await sendGmail(alert);
    if (res.successful === false) {
      console.error(`[postAlert] Composio respondió error:`, res.error);
      renderConsole(alert);
      return { ok: false, ref: `error:${res.error ?? 'unknown'}` };
    }
    return { ok: true, ref: extractRef(res) };
  } catch (err) {
    // Fallback en vivo: nunca tumbar la demo por una integración externa.
    console.error(`[postAlert] Composio falló, fallback a consola:`, err);
    renderConsole(alert);
    return { ok: false, ref: `error:${String((err as Error)?.message ?? err)}` };
  }
};

export default postAlert;
