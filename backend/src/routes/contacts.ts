import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  status: z
    .enum(["NOVO", "CONVERSANDO", "AGENDADO", "CONFIRMADO", "COMPARECEU", "FALTOU", "PERDIDO"])
    .optional(),
  tags: z.array(z.string()).optional(),
  lostReason: z.string().nullable().optional(),
  optOut: z.boolean().optional(),
});

export async function contactRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/contacts", async (req) => {
    const { status, search } = req.query as { status?: string; search?: string };
    return prisma.contact.findMany({
      where: {
        tenantId: req.user.tenantId,
        ...(status ? { status: status as any } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      include: { conversation: { select: { id: true, status: true, lastMessageAt: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  });

  // Contagem por etapa do funil
  app.get("/contacts/funnel", async (req) => {
    const groups = await prisma.contact.groupBy({
      by: ["status"],
      where: { tenantId: req.user.tenantId },
      _count: true,
    });
    return Object.fromEntries(groups.map((g) => [g.status, g._count]));
  });

  app.patch("/contacts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const contact = await prisma.contact.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!contact) return reply.code(404).send({ error: "Contato não encontrado" });
    return prisma.contact.update({ where: { id }, data: body });
  });
}
