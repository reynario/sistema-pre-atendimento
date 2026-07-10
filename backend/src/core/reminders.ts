import { prisma } from "../db.js";
import { scheduleReplaceable } from "../queues.js";

/**
 * Cria os lembretes de um agendamento (X horas antes, conforme configuração
 * da clínica) e agenda os jobs de envio na fila.
 */
export async function scheduleReminders(tenantId: string, appointmentId: string) {
  const [tenant, appointment] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } }),
  ]);

  const hoursList = [tenant.reminderHours1, tenant.reminderHours2].filter(
    (h): h is number => typeof h === "number" && h > 0,
  );

  for (const hours of hoursList) {
    const scheduledFor = new Date(appointment.startsAt.getTime() - hours * 60 * 60 * 1000);
    if (scheduledFor.getTime() <= Date.now()) continue;

    const reminder = await prisma.reminder.create({
      data: { tenantId, appointmentId, scheduledFor },
    });
    await scheduleReplaceable(
      `reminder:${reminder.id}`,
      { kind: "send-reminder", tenantId, reminderId: reminder.id },
      scheduledFor.getTime() - Date.now(),
    );
  }
}

/** Cancela lembretes pendentes de um agendamento (ao cancelar/remarcar). */
export async function cancelReminders(appointmentId: string) {
  await prisma.reminder.updateMany({
    where: { appointmentId, status: "PENDENTE" },
    data: { status: "CANCELADO" },
  });
}
