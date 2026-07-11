import { env } from "../env.js";

export type AudioInput = { url?: string | null; base64?: string | null };

/**
 * Transcreve um áudio do WhatsApp usando o Whisper da OpenAI.
 * Aceita URL (a UazAPI costuma entregar a mídia por URL no webhook) ou o
 * conteúdo em base64 (algumas versões entregam assim).
 * Retorna null se não houver chave/mídia ou se a transcrição falhar — nesse
 * caso a IA pede para o lead mandar por texto.
 */
export async function transcribeAudio(input: AudioInput): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;
  try {
    let buffer: Buffer | null = null;

    if (input.base64) {
      const b64 = input.base64.replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, "");
      buffer = Buffer.from(b64, "base64");
    } else if (input.url) {
      const audioRes = await fetch(input.url);
      if (!audioRes.ok) return null;
      buffer = Buffer.from(await audioRes.arrayBuffer());
    }
    if (!buffer || buffer.length < 100) return null;

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: "audio/ogg" }), "audio.ogg");
    form.append("model", "whisper-1");
    form.append("language", "pt");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    return data.text?.trim() || null;
  } catch {
    return null;
  }
}
