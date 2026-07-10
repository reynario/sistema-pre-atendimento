import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const serviceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  durationMin: z.number().int().min(5),
  priceCents: z.number().int().min(0),
  professionalId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export async function serviceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/services", async (req) => {
    return prisma.service.findMany({
      where: { tenantId: req.user.tenantId },
      include: { professional: true },
      orderBy: { name: "asc" },
    });
  });

  app.post("/services", async (req, reply) => {
    const body = serviceSchema.parse(req.body);
    const service = await prisma.service.create({
      data: { ...body, tenantId: req.user.tenantId },
    });
    return reply.code(201).send(service);
  });

  app.patch("/services/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = serviceSchema.partial().parse(req.body);
    const existing = await prisma.service.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Serviço não encontrado" });
    return prisma.service.update({ where: { id }, data: body });
  });

  app.delete("/services/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.service.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Serviço não encontrado" });
    // Desativa em vez de excluir (agendamentos antigos referenciam o serviço)
    return prisma.service.update({ where: { id }, data: { active: false } });
  });

  // Profissionais
  app.get("/professionals", async (req) => {
    return prisma.professional.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { name: "asc" },
    });
  });

  app.post("/professionals", async (req, reply) => {
    const body = z.object({ name: z.string().min(1) }).parse(req.body);
    const professional = await prisma.professional.create({
      data: { name: body.name, tenantId: req.user.tenantId },
    });
    return reply.code(201).send(professional);
  });

  app.delete("/professionals/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.professional.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Profissional não encontrado" });
    await prisma.professional.delete({ where: { id } });
    return { ok: true };
  });
}
