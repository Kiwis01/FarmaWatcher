// Cliente LLM único, OpenAI-compatible, parametrizado por LLM_BASE_URL / LLM_API_KEY.
// Default: AI Gateway de TrueFoundry (virtual key emitida por Persona B).
// Cambiar de modelo = cambiar el string `model`.
// Fallback en vivo: apuntar LLM_BASE_URL a un proveedor directo (mismo código).

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletion {
  choices?: { message?: { content?: string } }[];
}

export async function llmComplete(
  model: string,
  prompt: string,
  opts: { system?: string; temperature?: number } = {},
): Promise<string> {
  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  if (!base || !key) {
    throw new Error("LLM_BASE_URL/LLM_API_KEY no configurados");
  }

  const messages: LlmMessage[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.2,
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as ChatCompletion;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM respondió sin contenido");
  return content.trim();
}
