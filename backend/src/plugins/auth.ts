import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { env } from "../env.js";
import { prisma } from "../db.js";

export function isAdminEmail(email: string): boolean {
  return env.ADMIN_EMAILS.includes(email.toLowerCase());
}

export type AuthUser = {
  userId: string;
  tenantId: string;
  role: "OWNER" | "STAFF";
};

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireOwner: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function registerAuth(app: FastifyInstance) {
  await app.register(fastifyJwt, { secret: env.JWT_SECRET });

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Não autenticado" });
    }
  });

  // Ações restritas ao dono da clínica (plano, configurações, equipe)
  app.decorate("requireOwner", async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user?.role !== "OWNER") {
      reply.code(403).send({ error: "Apenas o dono da conta pode fazer isso" });
    }
  });

  // Admin da plataforma (você): e-mail precisa estar em ADMIN_EMAILS
  app.decorate("requireAdmin", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { email: true },
    });
    if (!user || !isAdminEmail(user.email)) {
      reply.code(403).send({ error: "Acesso restrito ao administrador da plataforma" });
    }
  });
}
