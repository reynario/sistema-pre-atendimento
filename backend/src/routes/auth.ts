import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { isSubscriptionActive } from "../core/subscription.js";

const registerSchema = z.object({
  clinicName: z.string().min(2),
  userName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  planCycle: z.enum(["MENSAL", "TRIMESTRAL", "ANUAL"]).default("MENSAL"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (req, reply) => {
    const body = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return reply.code(409).send({ error: "E-mail já cadastrado" });

    let slug = slugify(body.clinicName);
    if (await prisma.tenant.findUnique({ where: { slug } })) {
      slug = `${slug}-${crypto.randomBytes(2).toString("hex")}`;
    }

    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const tenant = await prisma.tenant.create({
      data: {
        name: body.clinicName,
        slug,
        webhookToken: crypto.randomBytes(24).toString("hex"),
        planCycle: body.planCycle,
        subscriptionStatus: "TRIAL",
        trialEndsAt,
        // Disponibilidade padrão: seg a sex, 09h às 18h (ajustável no painel)
        availabilityRules: {
          create: [1, 2, 3, 4, 5].map((weekday) => ({
            weekday,
            startTime: "09:00",
            endTime: "18:00",
          })),
        },
      },
    });

    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: body.userName,
        email: body.email,
        passwordHash: await bcrypt.hash(body.password, 10),
        role: "OWNER",
      },
    });

    const token = app.jwt.sign(
      { userId: user.id, tenantId: tenant.id, role: user.role },
      { expiresIn: "30d" },
    );
    return reply.code(201).send({ token, user: { name: user.name, email: user.email } });
  });

  app.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "E-mail ou senha incorretos" });
    }
    const token = app.jwt.sign(
      { userId: user.id, tenantId: user.tenantId, role: user.role },
      { expiresIn: "30d" },
    );
    return { token, user: { name: user.name, email: user.email } };
  });

  app.get("/auth/me", { preHandler: [app.authenticate] }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.userId } });
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: req.user.tenantId } });
    return {
      user: { name: user.name, email: user.email, role: user.role },
      tenant: {
        name: tenant.name,
        slug: tenant.slug,
        planCycle: tenant.planCycle,
        subscriptionStatus: tenant.subscriptionStatus,
        subscriptionActive: isSubscriptionActive(tenant),
        trialEndsAt: tenant.trialEndsAt,
        whatsappConnected: Boolean(tenant.uazapiToken),
        webhookUrl: `${env.PUBLIC_URL}/webhooks/uazapi/${tenant.webhookToken}`,
      },
    };
  });
}
