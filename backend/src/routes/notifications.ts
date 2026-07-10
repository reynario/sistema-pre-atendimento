import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/notifications", async (req) => {
    return prisma.notification.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });

  app.get("/notifications/unread-count", async (req) => {
    const count = await prisma.notification.count({
      where: { tenantId: req.user.tenantId, readAt: null },
    });
    return { count };
  });

  app.post("/notifications/read-all", async (req) => {
    await prisma.notification.updateMany({
      where: { tenantId: req.user.tenantId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
}
