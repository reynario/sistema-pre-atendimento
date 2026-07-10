import { Worker } from "bullmq";
import { prisma } from "../db.js";
import { redisConnection, scheduleReplaceable, type JobData } from "../queues.js";
import { runSdr } from "../ai/sdr.js";
import { whatsapp } from "../whatsapp/provider.js";
import { notify } from "../core/notify.js";

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
      }
    },
    { connection: redisConnection, concurrency: 5 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] job ${job?.id} falhou:`, err.message);
  });

  return worker;
}
