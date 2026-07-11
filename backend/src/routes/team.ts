import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { env } from "../env.js";

/**
 * Equipe: o dono gera um link de convite e manda pra recepcionista pelo
 * WhatsApp; quem abre o link cria a própria conta como STAFF.
 */
export async function teamRoutes(app: FastifyInstance) {
  // Listagem visível pra todos; gestão só pro dono
  app.get("/team", { preHandler: [app.authenticate] }, async (req) => {
    const [users, invites] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId: req.user.tenantId },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.invite.findMany({
        where: {
          tenantId: req.user.tenantId,
          usedAt: null,
          expiresAt: { gte: new Date() },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      users,
      invites: invites.map((i) => ({
        id: i.id,
        label: i.label,
        expiresAt: i.expiresAt,
        url: `${env.FRONTEND_ORIGIN}/convite/${i.token}`,
      })),
    };
  });

  app.post(
    "/team/invites",
    { preHandler: [app.authenticate, app.requireOwner] },
    async (req, reply) => {
      const body = z.object({ label: z.string().optional() }).parse(req.body ?? {});
      const invite = await prisma.invite.create({
        data: {
          tenantId: req.user.tenantId,
          token: crypto.randomBytes(24).toString("hex"),
          label: body.label,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      return reply.code(201).send({
        id: invite.id,
        label: invite.label,
        expiresAt: invite.expiresAt,
        url: `${env.FRONTEND_ORIGIN}/convite/${invite.token}`,
      });
    },
  );

  app.delete(
    "/team/invites/:id",
    { preHandler: [app.authenticate, app.requireOwner] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const invite = await prisma.invite.findFirst({
        where: { id, tenantId: req.user.tenantId },
      });
      if (!invite) return reply.code(404).send({ error: "Convite não encontrado" });
      await prisma.invite.delete({ where: { id } });
      return { ok: true };
    },
  );

  app.delete(
    "/team/:userId",
    { preHandler: [app.authenticate, app.requireOwner] },
    async (req, reply) => {
      const { userId } = req.params as { userId: string };
      if (userId === req.user.userId) {
        return reply.code(400).send({ error: "Você não pode remover a si mesmo" });
      }
      const user = await prisma.user.findFirst({
        where: { id: userId, tenantId: req.user.tenantId },
      });
      if (!user) return reply.code(404).send({ error: "Usuário não encontrado" });
      if (user.role === "OWNER") {
        return reply.code(400).send({ error: "O dono da conta não pode ser removido" });
      }
      await prisma.user.delete({ where: { id: userId } });
      return { ok: true };
    },
  );

  // ---- Aceite do convite (público) ----

  app.get("/invites/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: { tenant: { select: { name: true } } },
    });
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      return reply.code(404).send({ error: "Convite inválido ou expirado" });
    }
    return { clinicName: invite.tenant.name, label: invite.label };
  });

  app.post("/invites/:token/accept", async (req, reply) => {
    const { token } = req.params as { token: string };
    const body = z
      .object({
        name: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(6),
      })
      .parse(req.body);

    const invite = await prisma.invite.findUnique({ where: { token } });
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      return reply.code(404).send({ error: "Convite inválido ou expirado" });
    }
    if (await prisma.user.findUnique({ where: { email: body.email } })) {
      return reply.code(409).send({ error: "E-mail já cadastrado" });
    }

    const bcrypt = await import("bcryptjs");
    const user = await prisma.user.create({
      data: {
        tenantId: invite.tenantId,
        name: body.name,
        email: body.email,
        passwordHash: await bcrypt.default.hash(body.password, 10),
        role: invite.role,
      },
    });
    await prisma.invite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });

    const jwt = app.jwt.sign(
      { userId: user.id, tenantId: user.tenantId, role: user.role },
      { expiresIn: "30d" },
    );
    return reply.code(201).send({ token: jwt, user: { name: user.name, email: user.email } });
  });
}
