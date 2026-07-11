import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { whatsapp } from "../whatsapp/provider.js";

const aiSettingsSchema = z.object({
  aiEnabled: z.boolean().optional(),
  aiTone: z.string().optional(),
  aiScheduleStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  aiScheduleEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  aiScheduleDays: z.string().optional(),
  afterHoursMessage: z.string().optional(),
  followUpEnabled: z.boolean().optional(),
  followUpHours: z.number().int().min(1).max(72).optional(),
  postVisitEnabled: z.boolean().optional(),
  googleReviewUrl: z.string().url().nullable().optional(),
  reminderHours1: z.number().int().min(1).max(168).optional(),
  reminderHours2: z.number().int().min(1).max(168).nullable().optional(),
  minAdvanceMinutes: z.number().int().min(0).optional(),
  uazapiToken: z.string().nullable().optional(),
  whatsappNumber: z.string().nullable().optional(),
});

export async function settingsRoutes(app: FastifyInstance) {
  // Configurações são território do dono (STAFF opera conversas/agenda/CRM)
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", app.requireOwner);

  app.get("/settings", async (req) => {
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: req.user.tenantId },
    });
    const { webhookToken, ...rest } = tenant;
    return {
      ...rest,
      webhookUrl: `${env.PUBLIC_URL}/webhooks/uazapi/${webhookToken}`,
    };
  });

  app.patch("/settings", async (req) => {
    const body = aiSettingsSchema.parse(req.body);
    const tenant = await prisma.tenant.update({
      where: { id: req.user.tenantId },
      data: body,
    });
    const { webhookToken, ...rest } = tenant;
    return { ...rest, webhookUrl: `${env.PUBLIC_URL}/webhooks/uazapi/${webhookToken}` };
  });

  // Status da conexão WhatsApp (e QR code, quando desconectado)
  app.get("/settings/whatsapp-status", async (req) => {
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: req.user.tenantId },
    });
    if (!tenant.uazapiToken) {
      return { configured: false, connected: false };
    }
    try {
      const status = await whatsapp.getStatus(tenant);
      return { configured: true, ...status };
    } catch {
      return { configured: true, connected: false, error: "Falha ao consultar a UazAPI" };
    }
  });

  // Desconecta o WhatsApp da clínica (troca de número): encerra a sessão na
  // UazAPI (melhor esforço) e limpa o token — a IA para de atender na hora.
  app.post("/settings/whatsapp-disconnect", async (req) => {
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: req.user.tenantId },
    });
    if (tenant.uazapiToken) {
      await whatsapp.disconnect(tenant).catch((err) => {
        req.log.warn({ err: err?.message }, "falha ao desconectar instância na UazAPI");
      });
    }
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { uazapiToken: null, whatsappNumber: null },
    });
    return { ok: true };
  });

  // Trocar plano (billing automatizado fica pra Fase 2 — aqui só registra a escolha)
  app.patch("/settings/plan", async (req) => {
    const body = z
      .object({ planCycle: z.enum(["MENSAL", "TRIMESTRAL", "ANUAL"]) })
      .parse(req.body);
    return prisma.tenant.update({
      where: { id: req.user.tenantId },
      data: { planCycle: body.planCycle },
      select: { planCycle: true, subscriptionStatus: true, trialEndsAt: true },
    });
  });

  // Base de conhecimento
  app.get("/knowledge", async (req) => {
    return prisma.knowledgeItem.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { createdAt: "desc" },
    });
  });

  app.post("/knowledge", async (req, reply) => {
    const body = z
      .object({ title: z.string().min(1), content: z.string().min(1) })
      .parse(req.body);
    const item = await prisma.knowledgeItem.create({
      data: { ...body, tenantId: req.user.tenantId },
    });
    return reply.code(201).send(item);
  });

  app.patch("/knowledge/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({ title: z.string().min(1).optional(), content: z.string().min(1).optional() })
      .parse(req.body);
    const existing = await prisma.knowledgeItem.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Item não encontrado" });
    return prisma.knowledgeItem.update({ where: { id }, data: body });
  });

  app.delete("/knowledge/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.knowledgeItem.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Item não encontrado" });
    await prisma.knowledgeItem.delete({ where: { id } });
    return { ok: true };
  });
}
