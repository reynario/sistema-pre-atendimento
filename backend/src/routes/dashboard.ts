import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard", { preHandler: [app.authenticate] }, async (req) => {
    const tenantId = req.user.tenantId;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const [appointmentsToday, newLeads, awaitingHuman, todayList, escalated] =
      await Promise.all([
        prisma.appointment.count({
          where: {
            tenantId,
            startsAt: { gte: dayStart, lt: dayEnd },
            status: { in: ["AGENDADO", "CONFIRMADO"] },
          },
        }),
        prisma.contact.count({
          where: { tenantId, status: "NOVO", createdAt: { gte: dayStart } },
        }),
        prisma.conversation.count({ where: { tenantId, status: "HUMANO" } }),
        prisma.appointment.findMany({
          where: {
            tenantId,
            startsAt: { gte: dayStart, lt: dayEnd },
            status: { in: ["AGENDADO", "CONFIRMADO"] },
          },
          include: { contact: true, service: true, professional: true },
          orderBy: { startsAt: "asc" },
          take: 10,
        }),
        prisma.conversation.findMany({
          where: { tenantId, status: "HUMANO" },
          include: {
            contact: true,
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
          },
          orderBy: { lastMessageAt: "desc" },
          take: 5,
        }),
      ]);

    return {
      stats: { appointmentsToday, newLeads, awaitingHuman },
      todayAppointments: todayList,
      awaitingConversations: escalated,
    };
  });
}
