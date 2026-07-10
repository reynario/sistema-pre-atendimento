import { prisma } from "../db.js";

export async function notify(
  tenantId: string,
  type: "ESCALADO" | "AGENDAMENTO" | "CANCELAMENTO" | "CONFIRMACAO" | "FOLLOWUP",
  title: string,
  body: string,
) {
  await prisma.notification.create({ data: { tenantId, type, title, body } });
}
