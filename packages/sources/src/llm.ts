// Cliente LLM único, OpenAI-compatible, parametrizado por LLM_BASE_URL / LLM_API_KEY.
// Default: AI Gateway de TrueFoundry (virtual key emitida por Persona B).
// Cambiar de modelo = cambiar el string `model`.
// Fallback en vivo: apuntar LLM_BASE_URL a un proveedor directo (solo llmComplete:
// los prompts del registry son exclusivos del gateway de TrueFoundry).

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletion {
  choices?: { message?: { content?: string } }[];
}

async function chat(body: Record<string, unknown>): Promise<string> {
  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  if (!base || !key) {
    throw new Error("LLM_BASE_URL/LLM_API_KEY not configured");
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`LLM ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as ChatCompletion;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");
  return content.trim();
}

export async function llmComplete(
  model: string,
  prompt: string,
  opts: { system?: string; temperature?: number } = {},
): Promise<string> {
  const messages: LlmMessage[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  return chat({ model, messages, temperature: opts.temperature ?? 0.2 });
}

// Ejecuta un prompt guardado en el Prompt Registry de TrueFoundry: el gateway
// renderiza la plantilla server-side sustituyendo {{variables}}. El prompt ya
// no vive en este repo; se edita y versiona en el UI (ML Repos -> Prompts).
export async function llmPromptComplete(
  promptVersionFqn: string,
  variables: Record<string, string>,
  opts: { model?: string; temperature?: number } = {},
): Promise<string> {
  return chat({
    ...(opts.model ? { model: opts.model } : {}),
    messages: [],
    prompt_version_fqn: promptVersionFqn,
    prompt_variables: variables,
    temperature: opts.temperature ?? 0.2,
  });
}
