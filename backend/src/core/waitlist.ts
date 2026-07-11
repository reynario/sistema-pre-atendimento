import { prisma } from "../db.js";
import { whatsapp } from "../whatsapp/provider.js";
import { notify } from "./notify.js";

/**
 * Chamado quando um agendamento é cancelado: procura o primeiro da lista de
 * espera (mesmo serviço, ou sem serviço definido), avisa o lead pelo WhatsApp
 * e notifica a equipe. A resposta do lead cai no fluxo normal da IA, que
 * consulta a agenda e marca.
 */
export async function processWaitlistForSlot(tenantId: string, appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { service: true, tenant: true },
  });
  if (!appointment || appointment.status !== "CANCELADO") return;
  // Só faz sentido avisar se o horário liberado é futuro
  if (appointment.startsAt.getTime() <= Date.now()) return;

  const entry = await prisma.waitlistEntry.findFirst({
    where: {
      tenantId,
      status: "PENDENTE",
      OR: [{ serviceId: appointment.serviceId }, { serviceId: null }],
      contact: { optOut: false },
    },
    orderBy: { createdAt: "asc" },
    include: { contact: true, service: true },
  });
  if (!entry) return;

  const when = appointment.startsAt.toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const serviceName = entry.service?.name ?? appointment.service.name;
  const text =
    `Oi${entry.contact.name ? `, ${entry.contact.name}` : ""}! Boa notícia: abriu um horário de ` +
    `${serviceName} na ${appointment.tenant.name} — ${when}. Você estava na nossa lista de espera. ` +
    `Quer que eu agende pra você? É só responder por aqui! 😊`;

  await whatsapp.sendText(appointment.tenant, entry.contact.phone, text);

  const conversation = await prisma.conversation.upsert({
    where: { contactId: entry.contactId },
    create: { tenantId, contactId: entry.contactId },
    update: { lastMessageAt: new Date() },
  });
  await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      direction: "OUT",
      sender: "SISTEMA",
      content: text,
    },
  });
  await prisma.waitlistEntry.update({
    where: { id: entry.id },
    data: { status: "AVISADO" },
  });
  await notify(
    tenantId,
    "AGENDAMENTO",
    "Lista de espera acionada",
    `${entry.contact.name ?? entry.contact.phone} foi avisado do horário que vagou (${when}).`,
  );
}
