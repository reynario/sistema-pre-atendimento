import { Worker } from "bullmq";
import { prisma } from "../db.js";
import { jobsQueue, redisConnection, scheduleReplaceable, type JobData } from "../queues.js";
import { runSdr } from "../ai/sdr.js";
import { whatsapp } from "../whatsapp/provider.js";
import { notify } from "../core/notify.js";
import { isSubscriptionActive, notifySubscriptionPaused } from "../core/subscription.js";
import { processWaitlistForSlot } from "../core/waitlist.js";

/** Verifica se agora está dentro do horário de atuação da IA da clínica. */
function withinAiSchedule(tenant: {
  aiScheduleStart: string;
  aiScheduleEnd: string;
  aiScheduleDays: string;
}): boolean {
  const now = new Date();
  const days = tenant.aiScheduleDays.split(",").map((d) => Number(d.trim()));
  if (!days.includes(now.getDay())) return false;
  const [sh, sm] = tenant.aiScheduleStart.split(":").map(Number);
  const [eh, em] = tenant.aiScheduleEnd.split(":").map(Number);
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= sh * 60 + sm && minutes <= eh * 60 + em;
}

async function processConversation(tenantId: string, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true, tenant: true },
  });
  if (!conversation) return;
  const { tenant, contact } = conversation;

  // Humano assumiu no meio do debounce, IA desligada ou lead pediu opt-out
  if (conversation.status !== "IA" || !tenant.aiEnabled || contact.optOut) return;

  // Trial expirado / assinatura inativa: IA pausa e avisa o dono (1x/dia)
  if (!isSubscriptionActive(tenant)) {
    await notifySubscriptionPaused(tenant);
    return;
  }

  const recent = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 40,
  });
  if (recent.length === 0 || recent[recent.length - 1].direction !== "IN") return;

  // Histórico no formato do modelo, mesclando mensagens consecutivas do mesmo lado
  const history: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of recent) {
    const role = m.direction === "IN" ? "user" : "assistant";
    const last = history[history.length - 1];
    if (last && last.role === role) last.content += `\n${m.content}`;
    else history.push({ role, content: m.content });
  }

  const outOfHours = !withinAiSchedule(tenant);

  const result = await runSdr({ tenant, contact, history });

  let reply = result.reply;
  if (outOfHours && reply) {
    reply = `${tenant.afterHoursMessage}\n\n${reply}`;
  }

  if (reply) {
    await whatsapp.sendText(tenant, contact.phone, reply);
    await prisma.message.create({
      data: {
        tenantId,
        conversationId,
        direction: "OUT",
        sender: "IA",
        content: reply,
      },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });
  }

  // Lead que estava NOVO passa a CONVERSANDO após o primeiro turno da IA
  if (contact.status === "NOVO") {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { status: "CONVERSANDO" },
    });
  }

  // Agenda follow-up de lead sumido (se habilitado, sem agendamento fechado e sem escalação)
  const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
  const shouldFollowUp =
    tenant.followUpEnabled &&
    !result.escalated &&
    !updated.optOut &&
    ["NOVO", "CONVERSANDO"].includes(updated.status);

  if (shouldFollowUp) {
    // Um follow-up pendente por contato: cancela anteriores e cria um novo
    await prisma.followUp.updateMany({
      where: { contactId: contact.id, status: "PENDENTE" },
      data: { status: "CANCELADO" },
    });
    const attempts = await prisma.followUp.count({
      where: { contactId: contact.id, status: "ENVIADO" },
    });
    if (attempts < 2) {
      const scheduledFor = new Date(Date.now() + tenant.followUpHours * 60 * 60 * 1000);
      const followUp = await prisma.followUp.create({
        data: { tenantId, contactId: contact.id, scheduledFor, attempt: attempts + 1 },
      });
      await scheduleReplaceable(
        `followup:${followUp.id}`,
        { kind: "send-followup", tenantId, followUpId: followUp.id },
        scheduledFor.getTime() - Date.now(),
      );
    }
  }
}

async function sendReminder(tenantId: string, reminderId: string) {
  const reminder = await prisma.reminder.findUnique({
    where: { id: reminderId },
    include: {
      appointment: { include: { contact: true, service: true, professional: true } },
      tenant: true,
    },
  });
  if (!reminder || reminder.status !== "PENDENTE") return;

  const { appointment, tenant } = reminder;
  if (!["AGENDADO", "CONFIRMADO"].includes(appointment.status)) {
    await prisma.reminder.update({ where: { id: reminderId }, data: { status: "CANCELADO" } });
    return;
  }
  if (appointment.contact.optOut) return;

  const when = appointment.startsAt.toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const text =
    `Oi${appointment.contact.name ? `, ${appointment.contact.name}` : ""}! ` +
    `Passando pra lembrar do seu horário na ${tenant.name}: ${appointment.service.name}, ${when}` +
    (appointment.professional ? ` com ${appointment.professional.name}` : "") +
    `. Pode confirmar sua presença? Se precisar remarcar ou cancelar, é só me avisar por aqui. 😊`;

  await whatsapp.sendText(tenant, appointment.contact.phone, text);

  const conversation = await prisma.conversation.upsert({
    where: { contactId: appointment.contactId },
    create: { tenantId, contactId: appointment.contactId },
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
  await prisma.reminder.update({ where: { id: reminderId }, data: { status: "ENVIADO" } });
}

async function sendFollowUp(tenantId: string, followUpId: string) {
  const followUp = await prisma.followUp.findUnique({
    where: { id: followUpId },
    include: { contact: true, tenant: true },
  });
  if (!followUp || followUp.status !== "PENDENTE") return;

  const { contact, tenant } = followUp;
  if (contact.optOut || !["NOVO", "CONVERSANDO"].includes(contact.status)) {
    await prisma.followUp.update({ where: { id: followUpId }, data: { status: "CANCELADO" } });
    return;
  }

  // Assinatura inativa: follow-ups suspensos (lembretes de consulta continuam)
  if (!isSubscriptionActive(tenant)) {
    await prisma.followUp.update({ where: { id: followUpId }, data: { status: "CANCELADO" } });
    return;
  }

  const text =
    followUp.attempt === 1
      ? `Oi${contact.name ? `, ${contact.name}` : ""}! Ficou alguma dúvida? Posso te ajudar a escolher um horário 😊`
      : `Oi${contact.name ? `, ${contact.name}` : ""}! Vou deixar nosso atendimento por aqui, mas quando quiser agendar é só mandar uma mensagem, combinado?`;

  await whatsapp.sendText(tenant, contact.phone, text);

  const conversation = await prisma.conversation.upsert({
    where: { contactId: contact.id },
    create: { tenantId, contactId: contact.id },
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
  await prisma.followUp.update({ where: { id: followUpId }, data: { status: "ENVIADO" } });

  // Segunda tentativa sem resposta: marca como perdido
  if (followUp.attempt >= 2) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { status: "PERDIDO", lostReason: "Parou de responder (follow-ups esgotados)" },
    });
    await notify(
      tenantId,
      "FOLLOWUP",
      "Lead marcado como perdido",
      `${contact.name ?? contact.phone} não respondeu aos follow-ups.`,
    );
  }
}

/**
 * Pós-consulta: agradecimento + pedido de avaliação no Google, enviado
 * 1 hora depois de a recepção marcar "Compareceu". Uma vez por agendamento.
 */
async function sendPostVisit(tenantId: string, appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { contact: true, service: true, tenant: true },
  });
  if (!appointment || appointment.status !== "CONCLUIDO") return;
  const { tenant, contact } = appointment;
  if (!tenant.postVisitEnabled || contact.optOut || appointment.postVisitSentAt) return;

  let text =
    `Oi${contact.name ? `, ${contact.name}` : ""}! Passando pra agradecer sua visita à ` +
    `${tenant.name} hoje. Esperamos que tenha gostado! 💚`;
  if (tenant.googleReviewUrl) {
    text += `\n\nSe puder, deixe uma avaliação pra gente — ajuda muito: ${tenant.googleReviewUrl}`;
  }

  await whatsapp.sendText(tenant, contact.phone, text);

  const conversation = await prisma.conversation.upsert({
    where: { contactId: contact.id },
    create: { tenantId, contactId: contact.id },
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
  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { postVisitSentAt: new Date() },
  });
}

/**
 * Verifica a conexão da instância UazAPI de cada clínica. Se caiu (celular
 * desligado, sessão expirada), avisa o dono — no máximo 1 aviso a cada 6h.
 */
async function checkWhatsAppConnections() {
  const tenants = await prisma.tenant.findMany({
    where: { uazapiToken: { not: null }, aiEnabled: true },
  });
  for (const tenant of tenants) {
    try {
      const status = await whatsapp.getStatus(tenant);
      if (status.connected) continue;

      const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const recent = await prisma.notification.findFirst({
        where: { tenantId: tenant.id, type: "WHATSAPP", createdAt: { gte: since } },
      });
      if (recent) continue;

      await notify(
        tenant.id,
        "WHATSAPP",
        "WhatsApp desconectado",
        "A conexão com o WhatsApp caiu — os leads não estão sendo respondidos. Abra o painel da UazAPI e escaneie o QR code novamente.",
      );
    } catch (err: any) {
      console.error(`[whatsapp-check] falha para ${tenant.slug}:`, err?.message);
    }
  }
}

export function startWorkers() {
  const worker = new Worker<JobData>(
    "alo-jobs",
    async (job) => {
      const data = job.data;
      switch (data.kind) {
        case "process-conversation":
          return processConversation(data.tenantId, data.conversationId);
        case "send-reminder":
          return sendReminder(data.tenantId, data.reminderId);
        case "send-followup":
          return sendFollowUp(data.tenantId, data.followUpId);
        case "check-whatsapp":
          return checkWhatsAppConnections();
        case "send-postvisit":
          return sendPostVisit(data.tenantId, data.appointmentId);
        case "process-waitlist":
          return processWaitlistForSlot(data.tenantId, data.appointmentId);
      }
    },
    { connection: redisConnection, concurrency: 5 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] job ${job?.id} falhou:`, err.message);
  });

  // Health-check da conexão WhatsApp a cada 15 minutos
  void jobsQueue.upsertJobScheduler(
    "check-whatsapp-scheduler",
    { every: 15 * 60 * 1000 },
    { name: "check-whatsapp", data: { kind: "check-whatsapp" } },
  );

  return worker;
}
