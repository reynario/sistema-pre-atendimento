import { env } from "../env.js";

/**
 * Transcreve um áudio do WhatsApp usando o Whisper da OpenAI.
 * Recebe a URL do arquivo (a UazAPI entrega a mídia por URL no webhook).
 * Retorna null se não houver chave configurada ou se a transcrição falhar —
 * nesse caso a IA responde pedindo para o lead mandar por texto.
 */
export async function transcribeAudio(audioUrl: string): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;
  try {
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) return null;
    const buffer = Buffer.from(await audioRes.arrayBuffer());

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "audio/ogg" }), "audio.ogg");
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
