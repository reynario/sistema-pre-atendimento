import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { whatsapp } from "../whatsapp/provider.js";

export async function conversationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/conversations", async (req) => {
    const { status } = req.query as { status?: string };
    return prisma.conversation.findMany({
      where: {
        tenantId: req.user.tenantId,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        contact: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });
  });

  app.get("/conversations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversation = await prisma.conversation.findFirst({
      where: { id, tenantId: req.user.tenantId },
      include: {
        contact: { include: { appointments: { orderBy: { startsAt: "desc" }, take: 3, include: { service: true } } } },
        messages: { orderBy: { createdAt: "asc" }, take: 200 },
      },
    });
    if (!conversation) return reply.code(404).send({ error: "Conversa não encontrada" });
    return conversation;
  });

  // Assumir: humano entra, IA silencia nesta conversa
  app.post("/conversations/:id/assume", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversation = await prisma.conversation.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!conversation) return reply.code(404).send({ error: "Conversa não encontrada" });
    return prisma.conversation.update({ where: { id }, data: { status: "HUMANO" } });
  });

  // Devolver para a IA
  app.post("/conversations/:id/release", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversation = await prisma.conversation.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!conversation) return reply.code(404).send({ error: "Conversa não encontrada" });
    return prisma.conversation.update({ where: { id }, data: { status: "IA" } });
  });

  // Enviar mensagem manual (como humano) pelo painel
  app.post("/conversations/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ content: z.string().min(1) }).parse(req.body);

    const conversation = await prisma.conversation.findFirst({
      where: { id, tenantId: req.user.tenantId },
      include: { contact: true, tenant: true },
    });
    if (!conversation) return reply.code(404).send({ error: "Conversa não encontrada" });

    // Enviar pelo painel assume a conversa automaticamente (pausa a IA)
    if (conversation.status === "IA") {
      await prisma.conversation.update({ where: { id }, data: { status: "HUMANO" } });
    }

    await whatsapp.sendText(conversation.tenant, conversation.contact.phone, body.content);

    const message = await prisma.message.create({
      data: {
        tenantId: req.user.tenantId,
        conversationId: id,
        direction: "OUT",
        sender: "HUMANO",
        content: body.content,
      },
    });
    await prisma.conversation.update({
      where: { id },
      data: { lastMessageAt: new Date() },
    });
    return reply.code(201).send(message);
  });
}
