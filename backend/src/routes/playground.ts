import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { runSdr } from "../ai/sdr.js";

/**
 * Playground: a clínica conversa com a própria IA dentro do painel.
 * Roda o mesmo SDR das conversas reais, mas em modo dryRun — nada é gravado
 * no CRM nem enviado ao WhatsApp; agendamentos são simulados.
 */
export async function playgroundRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.post("/playground", async (req) => {
    const body = z
      .object({
        messages: z.array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1),
          }),
        ),
      })
      .parse(req.body);

    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: req.user.tenantId },
    });

    // Contato fictício, nunca persistido
    const fakeContact = {
      id: "playground",
      tenantId: tenant.id,
      phone: "5500000000000",
      name: null,
      status: "NOVO",
      tags: [],
      lostReason: null,
      optOut: false,
      createdAt: new Date(),
    } as any;

    const result = await runSdr({
      tenant,
      contact: fakeContact,
      history: body.messages,
      dryRun: true,
    });

    return {
      reply: result.reply,
      escalated: result.escalated,
      escalationReason: result.escalationReason ?? null,
      sandboxNotes: result.sandboxNotes,
    };
  });
}
