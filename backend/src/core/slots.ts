import { prisma } from "../db.js";
import { Prisma } from "@prisma/client";

const SLOT_STEP_MIN = 15;

/** "08:00" -> minutos desde 00:00 */
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type FreeSlot = { startsAt: string; endsAt: string };

/**
 * Calcula horários livres de um dia para um serviço (e opcionalmente um
 * profissional): regras de disponibilidade do dia da semana, menos
 * agendamentos ativos, menos bloqueios, respeitando antecedência mínima.
 *
 * As datas são tratadas no fuso do servidor (configure TZ=America/Sao_Paulo
 * no ambiente de produção).
 */
export async function getFreeSlots(params: {
  tenantId: string;
  date: string; // "2026-07-14"
  serviceId: string;
  professionalId?: string | null;
}): Promise<FreeSlot[]> {
  const { tenantId, date, serviceId, professionalId } = params;

  const [tenant, service] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    prisma.service.findFirstOrThrow({ where: { id: serviceId, tenantId } }),
  ]);

  const dayStart = new Date(`${date}T00:00:00`);
  if (Number.isNaN(dayStart.getTime())) throw new Error("Data inválida");
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const weekday = dayStart.getDay();

  // Se o serviço tem profissional fixo, ele prevalece
  const effectiveProfessionalId = professionalId ?? service.professionalId ?? null;

  // Grade do profissional prevalece; sem grade própria, vale a grade geral
  let rules = effectiveProfessionalId
    ? await prisma.availabilityRule.findMany({
        where: { tenantId, weekday, professionalId: effectiveProfessionalId },
      })
    : [];
  if (rules.length === 0) {
    const hasOwnGrid = effectiveProfessionalId
      ? (await prisma.availabilityRule.count({
          where: { tenantId, professionalId: effectiveProfessionalId },
        })) > 0
      : false;
    if (!hasOwnGrid) {
      rules = await prisma.availabilityRule.findMany({
        where: { tenantId, weekday, professionalId: null },
      });
    }
  }
  if (rules.length === 0) return [];

  const [appointments, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        tenantId,
        status: { in: ["AGENDADO", "CONFIRMADO"] },
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
        ...(effectiveProfessionalId ? { professionalId: effectiveProfessionalId } : {}),
      },
      select: { startsAt: true, endsAt: true },
    }),
    prisma.scheduleBlock.findMany({
      where: {
        tenantId,
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
        OR: effectiveProfessionalId
          ? [{ professionalId: effectiveProfessionalId }, { professionalId: null }]
          : [{}],
      },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  const busy = [...appointments, ...blocks];
  const minStart = new Date(Date.now() + tenant.minAdvanceMinutes * 60 * 1000);
  const slots: FreeSlot[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    const ruleStart = toMin(rule.startTime);
    const ruleEnd = toMin(rule.endTime);
    for (let m = ruleStart; m + service.durationMin <= ruleEnd; m += SLOT_STEP_MIN) {
      const start = new Date(dayStart.getTime() + m * 60 * 1000);
      const end = new Date(start.getTime() + service.durationMin * 60 * 1000);
      if (start < minStart) continue;
      if (busy.some((b) => overlaps(start, end, b.startsAt, b.endsAt))) continue;
      const key = start.toISOString();
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push({ startsAt: key, endsAt: end.toISOString() });
    }
  }

  slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return slots;
}

/**
 * Cria um agendamento com verificação de conflito dentro de uma transação
 * serializável — dois leads negociando o mesmo horário ao mesmo tempo nunca
 * geram overbooking (um dos dois recebe erro e a IA oferece outro horário).
 */
export async function createAppointmentSafe(params: {
  tenantId: string;
  contactId: string;
  serviceId: string;
  professionalId?: string | null;
  startsAt: Date;
  createdBy: "IA" | "HUMANO";
  notes?: string;
}) {
  const service = await prisma.service.findFirstOrThrow({
    where: { id: params.serviceId, tenantId: params.tenantId },
  });
  const professionalId = params.professionalId ?? service.professionalId ?? null;
  const endsAt = new Date(params.startsAt.getTime() + service.durationMin * 60 * 1000);

  return prisma.$transaction(
    async (tx) => {
      const conflict = await tx.appointment.findFirst({
        where: {
          tenantId: params.tenantId,
          status: { in: ["AGENDADO", "CONFIRMADO"] },
          startsAt: { lt: endsAt },
          endsAt: { gt: params.startsAt },
          ...(professionalId ? { professionalId } : {}),
        },
      });
      if (conflict) throw new Error("HORARIO_OCUPADO");

      const appointment = await tx.appointment.create({
        data: {
          tenantId: params.tenantId,
          contactId: params.contactId,
          serviceId: params.serviceId,
          professionalId,
          startsAt: params.startsAt,
          endsAt,
          createdBy: params.createdBy,
          notes: params.notes,
        },
        include: { service: true, contact: true, professional: true },
      });

      await tx.contact.update({
        where: { id: params.contactId },
        data: { status: "AGENDADO" },
      });

      return appointment;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
