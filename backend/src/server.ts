import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { env } from "./env.js";
import { registerAuth } from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { conversationRoutes } from "./routes/conversations.js";
import { contactRoutes } from "./routes/contacts.js";
import { serviceRoutes } from "./routes/services.js";
import { appointmentRoutes } from "./routes/appointments.js";
import { settingsRoutes } from "./routes/settings.js";
import { notificationRoutes } from "./routes/notifications.js";
import { playgroundRoutes } from "./routes/playground.js";
import { webhookRoutes } from "./routes/webhooks.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: [env.FRONTEND_ORIGIN, "http://localhost:5173"],
    credentials: true,
  });

  await registerAuth(app);

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "Dados inválidos", details: err.flatten() });
    }
    app.log.error(err);
    const status = err?.statusCode ?? 500;
    // Erros 5xx não vazam detalhes internos (Prisma, stack) para o cliente
    const message = status < 500 ? (err?.message ?? "Erro na requisição") : "Erro interno";
    return reply.code(status).send({ error: message });
  });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(dashboardRoutes);
  await app.register(conversationRoutes);
  await app.register(contactRoutes);
  await app.register(serviceRoutes);
  await app.register(appointmentRoutes);
  await app.register(settingsRoutes);
  await app.register(notificationRoutes);
  await app.register(playgroundRoutes);
  await app.register(webhookRoutes);

  return app;
}
