import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { pushEnabled } from "../core/push.js";

export async function pushRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/push/public-key", async () => ({
    enabled: pushEnabled,
    publicKey: env.VAPID_PUBLIC_KEY || null,
  }));

  app.post("/push/subscribe", async (req, reply) => {
    const body = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string(), auth: z.string() }),
      })
      .parse(req.body);

    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        tenantId: req.user.tenantId,
        userId: req.user.userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      update: {
        tenantId: req.user.tenantId,
        userId: req.user.userId,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });
    return reply.code(201).send({ ok: true });
  });

  app.post("/push/unsubscribe", async (req) => {
    const body = z.object({ endpoint: z.string() }).parse(req.body);
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: body.endpoint, userId: req.user.userId },
    });
    return { ok: true };
  });
}
