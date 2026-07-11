import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

// Preço por 1M de tokens (US$) — atualizar se trocar de modelo
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2, output: 8 },
};

function estimateCostUsd(rows: { model: string; inputTokens: number; outputTokens: number }[]) {
  let usd = 0;
  for (const r of rows) {
    const price = MODEL_PRICES[r.model];
    if (!price) continue;
    usd += (r.inputTokens / 1_000_000) * price.input + (r.outputTokens / 1_000_000) * price.output;
  }
  return usd;
}

/**
 * Relatórios do período: funil, conversão, no-show, série diária de leads e
 * agendamentos, ranking de serviços e atividade da IA.
 */
export async function reportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/reports", async (req) => {
    const tenantId = req.user.tenantId;
    const daysRaw = Number((req.query as { days?: string }).days ?? 30);
    const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : 30, 7), 90);

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const [
      newContacts,
      funnelGroups,
      appointmentsInPeriod,
      apptStatusGroups,
      serviceGroups,
      aiMessages,
      escalations,
    ] = await Promise.all([
      prisma.contact.findMany({
        where: { tenantId, createdAt: { gte: since } },
        select: { createdAt: true, status: true },
      }),
      prisma.contact.groupBy({ by: ["status"], where: { tenantId }, _count: true }),
      prisma.appointment.findMany({
        where: { tenantId, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.appointment.groupBy({
        by: ["status"],
        where: { tenantId, startsAt: { gte: since } },
        _count: true,
      }),
      prisma.appointment.groupBy({
        by: ["serviceId"],
        where: { tenantId, createdAt: { gte: since }, status: { not: "CANCELADO" } },
        _count: true,
        orderBy: { _count: { serviceId: "desc" } },
        take: 5,
      }),
      prisma.message.count({
        where: { tenantId, sender: "IA", createdAt: { gte: since } },
      }),
      prisma.notification.count({
        where: { tenantId, type: "ESCALADO", createdAt: { gte: since } },
      }),
    ]);

    const aiUsageRows = await prisma.aiUsage.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: { model: true, inputTokens: true, outputTokens: true },
    });
    const aiTokens = aiUsageRows.reduce(
      (acc, r) => ({ input: acc.input + r.inputTokens, output: acc.output + r.outputTokens }),
      { input: 0, output: 0 },
    );
    const aiCostUsd = estimateCostUsd(aiUsageRows);

    // Série diária (leads novos e agendamentos criados)
    const byDay: { date: string; leads: number; appointments: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      byDay.push({ date: d.toISOString().slice(0, 10), leads: 0, appointments: 0 });
    }
    const index = new Map(byDay.map((d, i) => [d.date, i]));
    for (const c of newContacts) {
      const key = c.createdAt.toISOString().slice(0, 10);
      const i = index.get(key);
      if (i !== undefined) byDay[i].leads++;
    }
    for (const a of appointmentsInPeriod) {
      const key = a.createdAt.toISOString().slice(0, 10);
      const i = index.get(key);
      if (i !== undefined) byDay[i].appointments++;
    }

    // Conversão: dos leads novos do período, quantos chegaram a agendar
    const converted = newContacts.filter((c) =>
      ["AGENDADO", "CONFIRMADO", "COMPARECEU"].includes(c.status),
    ).length;

    // No-show: dos atendimentos com desfecho no período
    const statusCount = Object.fromEntries(apptStatusGroups.map((g) => [g.status, g._count]));
    const done = statusCount.CONCLUIDO ?? 0;
    const missed = statusCount.FALTOU ?? 0;

    const services = await prisma.service.findMany({
      where: { id: { in: serviceGroups.map((g) => g.serviceId) } },
      select: { id: true, name: true },
    });
    const serviceName = new Map(services.map((s) => [s.id, s.name]));

    return {
      days,
      stats: {
        newLeads: newContacts.length,
        appointmentsCreated: appointmentsInPeriod.length,
        conversionRate: newContacts.length > 0 ? converted / newContacts.length : null,
        noShowRate: done + missed > 0 ? missed / (done + missed) : null,
        aiMessages,
        escalations,
        aiTokens,
        aiCostUsd,
      },
      funnel: Object.fromEntries(funnelGroups.map((g) => [g.status, g._count])),
      byDay,
      topServices: serviceGroups.map((g) => ({
        name: serviceName.get(g.serviceId) ?? "—",
        count: g._count,
      })),
    };
  });
}
