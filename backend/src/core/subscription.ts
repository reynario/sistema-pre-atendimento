import type { Tenant } from "@prisma/client";
import { prisma } from "../db.js";
import { notify } from "./notify.js";

/**
 * Assinatura ativa = plano pago em dia, ou trial ainda dentro do prazo.
 * Quando inativa, a IA para de responder e os follow-ups são suspensos
 * (lembretes de consultas já marcadas continuam saindo).
 */
export function isSubscriptionActive(tenant: Tenant): boolean {
  if (tenant.subscriptionStatus === "ATIVA") return true;
  if (tenant.subscriptionStatus === "TRIAL") {
    return !!tenant.trialEndsAt && tenant.trialEndsAt.getTime() > Date.now();
  }
  return false;
}

/** Avisa o dono que a IA está pausada por assinatura — no máximo 1x por dia. */
export async function notifySubscriptionPaused(tenant: Tenant) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.notification.findFirst({
    where: { tenantId: tenant.id, type: "ASSINATURA", createdAt: { gte: since } },
  });
  if (recent) return;
  await notify(
    tenant.id,
    "ASSINATURA",
    "IA pausada — período de teste encerrado",
    "Seu teste grátis terminou e a atendente parou de responder os leads. Assine em Meu plano para reativar.",
  );
}
