import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

export async function waitlistRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/waitlist", async (req) => {
    return prisma.waitlistEntry.findMany({
      where: { tenantId: req.user.tenantId, status: { in: ["PENDENTE", "AVISADO"] } },
      include: { contact: true, service: true },
      orderBy: { createdAt: "asc" },
    });
  });

  // Inclusão manual pela recepção
  app.post("/waitlist", async (req, reply) => {
    const body = z
      .object({
        contactPhone: z.string().min(8),
        contactName: z.string().optional(),
        serviceId: z.string().nullable().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const phone = body.contactPhone.replace(/\D/g, "");
    const contact = await prisma.contact.upsert({
      where: { tenantId_phone: { tenantId: req.user.tenantId, phone } },
      create: { tenantId: req.user.tenantId, phone, name: body.contactName },
      update: { ...(body.contactName ? { name: body.contactName } : {}) },
    });

    const entry = await prisma.waitlistEntry.create({
      data: {
        tenantId: req.user.tenantId,
        contactId: contact.id,
        serviceId: body.serviceId ?? null,
        notes: body.notes,
      },
      include: { contact: true, service: true },
    });
    return reply.code(201).send(entry);
  });

  app.delete("/waitlist/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const entry = await prisma.waitlistEntry.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!entry) return reply.code(404).send({ error: "Entrada não encontrada" });
    await prisma.waitlistEntry.update({ where: { id }, data: { status: "RESOLVIDO" } });
    return { ok: true };
  });
}
