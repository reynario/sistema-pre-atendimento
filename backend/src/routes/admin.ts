import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";

// Mensalidade equivalente por ciclo (centavos) — mesma tabela do frontend
const MONTHLY_EQUIVALENT_CENTS: Record<string, number> = {
  MENSAL: 18900,
  TRIMESTRAL: 16100, // 483/3
  ANUAL: 13242, // 1589/12
};

/**
 * Painel do administrador da plataforma (você): visão de clientes, receita,
 * consumo de IA, aprovação de cadastros e cupons.
 */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.addHook("preHandler", app.requireAdmin);

  app.get("/admin/overview", async () => {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [tenants, usage30d] = await Promise.all([
      prisma.tenant.findMany({
        select: {
          approvalStatus: true,
          subscriptionStatus: true,
          planCycle: true,
        },
      }),
      prisma.aiUsage.aggregate({
        where: { createdAt: { gte: since30d } },
        _sum: { inputTokens: true, outputTokens: true },
      }),
    ]);

    const count = (fn: (t: (typeof tenants)[number]) => boolean) => tenants.filter(fn).length;

    // MRR: clientes pagando; pipeline: trials aprovados que podem converter
    const mrrCents = tenants
      .filter((t) => t.subscriptionStatus === "ATIVA")
      .reduce((acc, t) => acc + (MONTHLY_EQUIVALENT_CENTS[t.planCycle] ?? 0), 0);
    const pipelineCents = tenants
      .filter((t) => t.approvalStatus === "APROVADO" && t.subscriptionStatus === "TRIAL")
      .reduce((acc, t) => acc + (MONTHLY_EQUIVALENT_CENTS[t.planCycle] ?? 0), 0);

    return {
      tenants: {
        total: tenants.length,
        pendentes: count((t) => t.approvalStatus === "PENDENTE"),
        ativos: count((t) => t.subscriptionStatus === "ATIVA"),
        emTrial: count(
          (t) => t.approvalStatus === "APROVADO" && t.subscriptionStatus === "TRIAL",
        ),
        inadimplentes: count((t) => t.subscriptionStatus === "INADIMPLENTE"),
      },
      revenue: { mrrCents, pipelineCents },
      aiUsage30d: {
        inputTokens: usage30d._sum.inputTokens ?? 0,
        outputTokens: usage30d._sum.outputTokens ?? 0,
      },
    };
  });

  app.get("/admin/tenants", async () => {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [tenants, usage] = await Promise.all([
      prisma.tenant.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          planCycle: true,
          subscriptionStatus: true,
          approvalStatus: true,
          trialEndsAt: true,
          couponCode: true,
          whatsappNumber: true,
          uazapiToken: true,
          users: { where: { role: "OWNER" }, select: { name: true, email: true }, take: 1 },
          _count: { select: { contacts: true, appointments: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.aiUsage.groupBy({
        by: ["tenantId"],
        where: { createdAt: { gte: since30d } },
        _sum: { inputTokens: true, outputTokens: true },
      }),
    ]);

    const usageByTenant = new Map(
      usage.map((u) => [
        u.tenantId,
        { input: u._sum.inputTokens ?? 0, output: u._sum.outputTokens ?? 0 },
      ]),
    );

    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      createdAt: t.createdAt,
      planCycle: t.planCycle,
      subscriptionStatus: t.subscriptionStatus,
      approvalStatus: t.approvalStatus,
      trialEndsAt: t.trialEndsAt,
      couponCode: t.couponCode,
      whatsappConnected: Boolean(t.uazapiToken),
      owner: t.users[0] ?? null,
      contacts: t._count.contacts,
      appointments: t._count.appointments,
      aiTokens30d: usageByTenant.get(t.id) ?? { input: 0, output: 0 },
    }));
  });

  app.post("/admin/tenants/:id/approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.code(404).send({ error: "Clínica não encontrada" });

    // Trial começa a contar da aprovação (+ dias extras de cupom, se houver)
    let extraDays = 0;
    if (tenant.couponCode) {
      const coupon = await prisma.coupon.findUnique({ where: { code: tenant.couponCode } });
      extraDays = coupon?.extraTrialDays ?? 0;
    }
    const trialEndsAt = new Date(Date.now() + (14 + extraDays) * 24 * 60 * 60 * 1000);

    return prisma.tenant.update({
      where: { id },
      data: { approvalStatus: "APROVADO", subscriptionStatus: "TRIAL", trialEndsAt },
    });
  });

  app.post("/admin/tenants/:id/reject", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.code(404).send({ error: "Clínica não encontrada" });
    return prisma.tenant.update({
      where: { id },
      data: { approvalStatus: "RECUSADO" },
    });
  });

  // Ajuste manual de assinatura (ex: marcar ATIVA após pagamento por link)
  app.patch("/admin/tenants/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        subscriptionStatus: z.enum(["TRIAL", "ATIVA", "INADIMPLENTE", "CANCELADA"]).optional(),
        trialEndsAt: z.string().datetime().optional(),
      })
      .parse(req.body);
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.code(404).send({ error: "Clínica não encontrada" });
    return prisma.tenant.update({
      where: { id },
      data: {
        ...(body.subscriptionStatus ? { subscriptionStatus: body.subscriptionStatus } : {}),
        ...(body.trialEndsAt ? { trialEndsAt: new Date(body.trialEndsAt) } : {}),
      },
    });
  });

  // ---- Cupons ----

  app.get("/admin/coupons", async () => {
    return prisma.coupon.findMany({ orderBy: { createdAt: "desc" } });
  });

  app.post("/admin/coupons", async (req, reply) => {
    const body = z
      .object({
        code: z.string().min(3).max(30),
        description: z.string().optional(),
        discountPercent: z.number().int().min(0).max(100).default(0),
        extraTrialDays: z.number().int().min(0).max(90).default(0),
        maxUses: z.number().int().min(1).nullable().optional(),
        expiresAt: z.string().datetime().nullable().optional(),
      })
      .parse(req.body);

    const code = body.code.trim().toUpperCase();
    if (await prisma.coupon.findUnique({ where: { code } })) {
      return reply.code(409).send({ error: "Já existe um cupom com esse código" });
    }
    const coupon = await prisma.coupon.create({
      data: {
        code,
        description: body.description,
        discountPercent: body.discountPercent,
        extraTrialDays: body.extraTrialDays,
        maxUses: body.maxUses ?? null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });
    return reply.code(201).send(coupon);
  });

  app.patch("/admin/coupons/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ active: z.boolean() }).parse(req.body);
    const coupon = await prisma.coupon.findUnique({ where: { id } });
    if (!coupon) return reply.code(404).send({ error: "Cupom não encontrado" });
    return prisma.coupon.update({ where: { id }, data: { active: body.active } });
  });
}
