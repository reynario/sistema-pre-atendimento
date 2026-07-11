import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getFreeSlots, createAppointmentSafe } from "../core/slots.js";
import { scheduleReminders, cancelReminders } from "../core/reminders.js";
import { jobsQueue } from "../queues.js";

export async function appointmentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // Agenda de um dia (opcionalmente filtrada por profissional)
  app.get("/appointments", async (req) => {
    const { date, professionalId } = req.query as { date?: string; professionalId?: string };
    const day = date ? new Date(`${date}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
    const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    return prisma.appointment.findMany({
      where: {
        tenantId: req.user.tenantId,
        startsAt: { gte: day, lt: dayEnd },
        ...(professionalId ? { professionalId } : {}),
      },
      include: { contact: true, service: true, professional: true },
      orderBy: { startsAt: "asc" },
    });
  });

  // Horários livres (mesma engine que a IA usa)
  app.get("/appointments/slots", async (req, reply) => {
    const query = z
      .object({
        date: z.string(),
        serviceId: z.string(),
        professionalId: z.string().optional(),
      })
      .parse(req.query);
    try {
      const slots = await getFreeSlots({
        tenantId: req.user.tenantId,
        date: query.date,
        serviceId: query.serviceId,
        professionalId: query.professionalId ?? null,
      });
      return slots;
    } catch {
      return reply.code(400).send({ error: "Parâmetros inválidos" });
    }
  });

  // Agendamento manual pela recepção
  app.post("/appointments", async (req, reply) => {
    const body = z
      .object({
        contactId: z.string().optional(),
        contactName: z.string().optional(),
        contactPhone: z.string().optional(),
        serviceId: z.string(),
        professionalId: z.string().nullable().optional(),
        startsAt: z.string(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    let contactId = body.contactId;
    if (!contactId) {
      if (!body.contactPhone) {
        return reply.code(400).send({ error: "Informe um contato ou telefone" });
      }
      const phone = body.contactPhone.replace(/\D/g, "");
      const contact = await prisma.contact.upsert({
        where: { tenantId_phone: { tenantId: req.user.tenantId, phone } },
        create: {
          tenantId: req.user.tenantId,
          phone,
          name: body.contactName,
          status: "AGENDADO",
        },
        update: { ...(body.contactName ? { name: body.contactName } : {}) },
      });
      contactId = contact.id;
    }

    try {
      const appointment = await createAppointmentSafe({
        tenantId: req.user.tenantId,
        contactId,
        serviceId: body.serviceId,
        professionalId: body.professionalId ?? null,
        startsAt: new Date(body.startsAt),
        createdBy: "HUMANO",
        notes: body.notes,
      });
      await scheduleReminders(req.user.tenantId, appointment.id);
      return reply.code(201).send(appointment);
    } catch (err: any) {
      if (err?.message === "HORARIO_OCUPADO") {
        return reply.code(409).send({ error: "Esse horário já está ocupado" });
      }
      throw err;
    }
  });

  // Atualizar status (confirmar, compareceu, faltou, cancelar)
  app.patch("/appointments/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        status: z.enum(["AGENDADO", "CONFIRMADO", "CONCLUIDO", "FALTOU", "CANCELADO"]),
      })
      .parse(req.body);

    const appointment = await prisma.appointment.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!appointment) return reply.code(404).send({ error: "Agendamento não encontrado" });

    const updated = await prisma.appointment.update({
      where: { id },
      data: { status: body.status },
    });

    // Reflete no funil do CRM
    const contactStatus =
      body.status === "CONFIRMADO"
        ? "CONFIRMADO"
        : body.status === "CONCLUIDO"
          ? "COMPARECEU"
          : body.status === "FALTOU"
            ? "FALTOU"
            : null;
    if (contactStatus) {
      await prisma.contact.update({
        where: { id: appointment.contactId },
        data: { status: contactStatus as any },
      });
    }
    if (body.status === "CANCELADO") {
      await cancelReminders(id);
      // Horário vagou: aciona a lista de espera
      await jobsQueue.add("process-waitlist", {
        kind: "process-waitlist",
        tenantId: req.user.tenantId,
        appointmentId: id,
      });
    }
    if (body.status === "CONCLUIDO") {
      // Pós-consulta: agradecimento + avaliação, 1 hora depois
      await jobsQueue.add(
        "send-postvisit",
        { kind: "send-postvisit", tenantId: req.user.tenantId, appointmentId: id },
        { delay: 60 * 60 * 1000 },
      );
    }

    return updated;
  });

  // Bloqueios de agenda (folgas, almoço, imprevistos)
  app.get("/schedule-blocks", async (req) => {
    return prisma.scheduleBlock.findMany({
      where: { tenantId: req.user.tenantId, endsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
    });
  });

  app.post("/schedule-blocks", async (req, reply) => {
    const body = z
      .object({
        startsAt: z.string(),
        endsAt: z.string(),
        reason: z.string().optional(),
        professionalId: z.string().nullable().optional(),
      })
      .parse(req.body);
    const block = await prisma.scheduleBlock.create({
      data: {
        tenantId: req.user.tenantId,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        reason: body.reason,
        professionalId: body.professionalId ?? null,
      },
    });
    return reply.code(201).send(block);
  });

  app.delete("/schedule-blocks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.scheduleBlock.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "Bloqueio não encontrado" });
    await prisma.scheduleBlock.delete({ where: { id } });
    return { ok: true };
  });

  // Regras de disponibilidade
  app.get("/availability-rules", async (req) => {
    return prisma.availabilityRule.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    });
  });

  // Substitui as regras de UM escopo: geral (professionalId null) ou de um
  // profissional específico — as grades dos outros escopos ficam intactas.
  app.put("/availability-rules", async (req) => {
    const body = z
      .object({
        professionalId: z.string().nullable().optional(),
        rules: z.array(
          z.object({
            weekday: z.number().int().min(0).max(6),
            startTime: z.string().regex(/^\d{2}:\d{2}$/),
            endTime: z.string().regex(/^\d{2}:\d{2}$/),
          }),
        ),
      })
      .parse(req.body);

    const professionalId = body.professionalId ?? null;

    await prisma.$transaction([
      prisma.availabilityRule.deleteMany({
        where: { tenantId: req.user.tenantId, professionalId },
      }),
      prisma.availabilityRule.createMany({
        data: body.rules.map((r) => ({
          tenantId: req.user.tenantId,
          weekday: r.weekday,
          startTime: r.startTime,
          endTime: r.endTime,
          professionalId,
        })),
      }),
    ]);
    return prisma.availabilityRule.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    });
  });
}
