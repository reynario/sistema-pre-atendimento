import { prisma } from "../db.js";
import { sendPushToTenant } from "./push.js";

export async function notify(
  tenantId: string,
  type:
    | "ESCALADO"
    | "AGENDAMENTO"
    | "CANCELAMENTO"
    | "CONFIRMACAO"
    | "FOLLOWUP"
    | "ASSINATURA"
    | "WHATSAPP",
  title: string,
  body: string,
) {
  await prisma.notification.create({ data: { tenantId, type, title, body } });
  // Push é melhor-esforço: falha de push nunca derruba o fluxo principal
  void sendPushToTenant(tenantId, title, body).catch(() => {});
}
