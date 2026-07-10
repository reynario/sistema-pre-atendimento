import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { scheduleReplaceable, cancelJob } from "../queues.js";
import { transcribeAudio } from "../ai/transcribe.js";

const DEBOUNCE_MS = 8000;

type InboundMessage = {
  phone: string;
  text: string | null;
  audioUrl: string | null;
  senderName: string | null;
  fromMe: boolean;
};

/**
 * Normaliza o payload de webhook da UazAPI. O formato pode variar entre
 * versões, então o parser é tolerante: procura os campos usuais em
 * body.message / body.data / body direto.
 */
function normalizeInbound(body: any): InboundMessage | null {
  const msg = body?.message ?? body?.data?.message ?? body?.data ?? body;
  if (!msg || typeof msg !== "object") return null;

  const fromMe = Boolean(msg.fromMe ?? msg.fromme ?? msg.key?.fromMe);

  const rawJid: string =
    msg.chatid ?? msg.chatId ?? msg.sender ?? msg.from ?? msg.key?.remoteJid ?? "";
  const phone = String(rawJid).replace(/@.*$/, "").replace(/\D/g, "");
  if (!phone) return null;

  // Grupos não são atendidos pela IA
  if (String(rawJid).includes("@g.us") || msg.isGroup) return null;

  const type: string = String(msg.messageType ?? msg.type ?? "").toLowerCase();

  let text: string | null =
    msg.text ?? msg.body ?? msg.content ?? msg.conversation ?? null;
  if (typeof text === "object") text = null;
  if (text != null) text = String(text).trim() || null;

  let audioUrl: string | null = null;
  if (type.includes("audio") || type.includes("ptt")) {
    audioUrl = msg.mediaUrl ?? msg.fileURL ?? msg.file ?? msg.url ?? null;
    text = null;
  }

  const senderName: string | null = msg.senderName ?? msg.pushName ?? msg.notifyName ?? null;

  return { phone, text, audioUrl, senderName, fromMe };
}

export async function webhookRoutes(app: FastifyInstance) {
  // Cada clínica tem sua URL de webhook: /webhooks/uazapi/<webhookToken>
  app.post("/webhooks/uazapi/:token", async (req, reply) => {
    const { token } = req.params as { token: string };

    const tenant = await prisma.tenant.findUnique({ where: { webhookToken: token } });
    if (!tenant) return reply.code(404).send({ error: "Webhook desconhecido" });

    const inbound = normalizeInbound(req.body);
    // Sempre responde 200 para a UazAPI não reenfileirar eventos que ignoramos
    if (!inbound || inbound.fromMe) return reply.send({ ok: true });

    let content = inbound.text;
    let msgType = "text";

    if (!content && inbound.audioUrl) {
      const transcript = await transcribeAudio(inbound.audioUrl);
      if (transcript) {
        content = transcript;
        msgType = "audio";
      } else {
        content = "[áudio recebido — transcrição indisponível]";
        msgType = "audio";
      }
    }
    if (!content) return reply.send({ ok: true, ignored: "sem conteúdo textual" });

    // Upsert do contato + conversa
    const contact = await prisma.contact.upsert({
      where: { tenantId_phone: { tenantId: tenant.id, phone: inbound.phone } },
      create: {
        tenantId: tenant.id,
        phone: inbound.phone,
        name: inbound.senderName,
        status: "NOVO",
      },
      update: {
        ...(inbound.senderName ? { name: inbound.senderName } : {}),
      },
    });

    // Lead voltou a falar: se estava NOVO continua NOVO até a IA qualificar;
    // se estava PERDIDO, reabre como CONVERSANDO
    if (contact.status === "PERDIDO") {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { status: "CONVERSANDO" },
      });
    }

    const conversation = await prisma.conversation.upsert({
      where: { contactId: contact.id },
      create: { tenantId: tenant.id, contactId: contact.id },
      update: { lastMessageAt: new Date() },
    });

    await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "IN",
        sender: "LEAD",
        type: msgType,
        content,
      },
    });

    // Lead respondeu: cancela follow-ups pendentes
    const pendingFollowUps = await prisma.followUp.findMany({
      where: { contactId: contact.id, status: "PENDENTE" },
    });
    for (const fu of pendingFollowUps) {
      await cancelJob(`followup:${fu.id}`);
    }
    if (pendingFollowUps.length > 0) {
      await prisma.followUp.updateMany({
        where: { contactId: contact.id, status: "PENDENTE" },
        data: { status: "CANCELADO" },
      });
    }

    // Debounce: agenda (ou reagenda) o processamento da conversa pela IA.
    // Mensagens picadas em sequência viram um único turno da IA.
    if (tenant.aiEnabled && conversation.status === "IA" && !contact.optOut) {
      await scheduleReplaceable(
        `conv:${conversation.id}`,
        { kind: "process-conversation", tenantId: tenant.id, conversationId: conversation.id },
        DEBOUNCE_MS,
      );
    }

    return reply.send({ ok: true });
  });
}
