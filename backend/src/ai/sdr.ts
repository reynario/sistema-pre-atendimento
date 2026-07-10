import OpenAI from "openai";
import type { Tenant, Contact } from "@prisma/client";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { getFreeSlots, createAppointmentSafe } from "../core/slots.js";
import { scheduleReminders, cancelReminders } from "../core/reminders.js";
import { notify } from "../core/notify.js";

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY || "nao-configurada" });

export type SdrResult = {
  reply: string | null;
  escalated: boolean;
  escalationReason?: string;
  /** Avisos do modo teste (ex: "agendamento simulado") */
  sandboxNotes: string[];
};

type ToolCtx = {
  tenant: Tenant;
  contact: Contact;
  /** Playground: nada é gravado no banco nem enviado ao WhatsApp */
  dryRun: boolean;
  result: SdrResult;
};

function fmtPrice(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "listar_servicos",
      description:
        "Lista os serviços oferecidos pela clínica com preço, duração e profissional. Use antes de informar qualquer preço.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "horarios_disponiveis",
      description:
        "Consulta os horários livres de um dia para um serviço. Use sempre que o lead quiser agendar — nunca invente horários.",
      parameters: {
        type: "object",
        properties: {
          data: { type: "string", description: "Data no formato YYYY-MM-DD" },
          servico_id: { type: "string", description: "ID do serviço (de listar_servicos)" },
        },
        required: ["data", "servico_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "criar_agendamento",
      description:
        "Cria o agendamento após o lead confirmar explicitamente um horário. Use apenas horários retornados por horarios_disponiveis.",
      parameters: {
        type: "object",
        properties: {
          servico_id: { type: "string" },
          data_hora: {
            type: "string",
            description: "Início no formato ISO retornado por horarios_disponiveis",
          },
          nome_cliente: { type: "string", description: "Nome do lead, se ele informou" },
        },
        required: ["servico_id", "data_hora"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirmar_agendamento",
      description: "Confirma a presença do lead no próximo agendamento dele (resposta a lembrete).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "cancelar_agendamento",
      description: "Cancela o próximo agendamento do lead, a pedido dele.",
      parameters: {
        type: "object",
        properties: { motivo: { type: "string" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalar_para_humano",
      description:
        "Transfere a conversa para a equipe humana. Use quando: o lead pedir para falar com uma pessoa, houver reclamação, ou você não souber responder com segurança.",
      parameters: {
        type: "object",
        properties: { motivo: { type: "string", description: "Resumo curto do motivo" } },
        required: ["motivo"],
      },
    },
  },
];

async function runTool(ctx: ToolCtx, name: string, input: any): Promise<string> {
  const { tenant, contact, dryRun } = ctx;

  switch (name) {
    case "listar_servicos": {
      const services = await prisma.service.findMany({
        where: { tenantId: tenant.id, active: true },
        include: { professional: true },
      });
      if (services.length === 0) return "Nenhum serviço cadastrado ainda.";
      return services
        .map(
          (s) =>
            `id=${s.id} | ${s.name} | ${fmtPrice(s.priceCents)} | ${s.durationMin} min` +
            (s.professional ? ` | ${s.professional.name}` : "") +
            (s.description ? ` | ${s.description}` : ""),
        )
        .join("\n");
    }

    case "horarios_disponiveis": {
      const slots = await getFreeSlots({
        tenantId: tenant.id,
        date: String(input.data),
        serviceId: String(input.servico_id),
      });
      if (slots.length === 0) return "Nenhum horário livre nesse dia. Sugira outro dia ao lead.";
      return slots
        .slice(0, 12)
        .map((s) => `${s.startsAt} (${fmtDateTime(new Date(s.startsAt))})`)
        .join("\n");
    }

    case "criar_agendamento": {
      if (dryRun) {
        ctx.result.sandboxNotes.push("Agendamento simulado (modo teste — nada foi gravado).");
        return `SIMULADO: agendamento criado para ${fmtDateTime(new Date(String(input.data_hora)))}. Confirme ao lead normalmente.`;
      }
      const startsAt = new Date(String(input.data_hora));
      if (Number.isNaN(startsAt.getTime())) return "ERRO: data_hora inválida.";

      if (input.nome_cliente && !contact.name) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { name: String(input.nome_cliente) },
        });
      }

      try {
        const appt = await createAppointmentSafe({
          tenantId: tenant.id,
          contactId: contact.id,
          serviceId: String(input.servico_id),
          startsAt,
          createdBy: "IA",
        });
        await scheduleReminders(tenant.id, appt.id);
        await notify(
          tenant.id,
          "AGENDAMENTO",
          "Novo agendamento",
          `${appt.contact.name ?? contact.phone} · ${appt.service.name} · ${fmtDateTime(appt.startsAt)}`,
        );
        return `OK: agendamento criado. ${appt.service.name}, ${fmtDateTime(appt.startsAt)}, ${fmtPrice(appt.service.priceCents)}.`;
      } catch (err: any) {
        if (err?.message === "HORARIO_OCUPADO") {
          return "ERRO: esse horário acabou de ser ocupado. Consulte horarios_disponiveis de novo e ofereça outra opção.";
        }
        throw err;
      }
    }

    case "confirmar_agendamento": {
      const appt = await prisma.appointment.findFirst({
        where: {
          tenantId: tenant.id,
          contactId: contact.id,
          status: "AGENDADO",
          startsAt: { gte: new Date() },
        },
        orderBy: { startsAt: "asc" },
        include: { service: true },
      });
      if (!appt) return "Nenhum agendamento pendente encontrado para este lead.";
      if (!dryRun) {
        await prisma.appointment.update({ where: { id: appt.id }, data: { status: "CONFIRMADO" } });
        await prisma.contact.update({ where: { id: contact.id }, data: { status: "CONFIRMADO" } });
        await notify(
          tenant.id,
          "CONFIRMACAO",
          "Consulta confirmada",
          `${contact.name ?? contact.phone} confirmou ${appt.service.name} em ${fmtDateTime(appt.startsAt)}`,
        );
      } else {
        ctx.result.sandboxNotes.push("Confirmação simulada (modo teste).");
      }
      return `OK: presença confirmada para ${appt.service.name} em ${fmtDateTime(appt.startsAt)}.`;
    }

    case "cancelar_agendamento": {
      const appt = await prisma.appointment.findFirst({
        where: {
          tenantId: tenant.id,
          contactId: contact.id,
          status: { in: ["AGENDADO", "CONFIRMADO"] },
          startsAt: { gte: new Date() },
        },
        orderBy: { startsAt: "asc" },
        include: { service: true },
      });
      if (!appt) return "Nenhum agendamento futuro encontrado para este lead.";
      if (!dryRun) {
        await prisma.appointment.update({ where: { id: appt.id }, data: { status: "CANCELADO" } });
        await prisma.contact.update({ where: { id: contact.id }, data: { status: "CONVERSANDO" } });
        await cancelReminders(appt.id);
        await notify(
          tenant.id,
          "CANCELAMENTO",
          "Cancelamento",
          `${contact.name ?? contact.phone} cancelou ${appt.service.name} de ${fmtDateTime(appt.startsAt)}` +
            (input?.motivo ? ` — motivo: ${input.motivo}` : ""),
        );
      } else {
        ctx.result.sandboxNotes.push("Cancelamento simulado (modo teste).");
      }
      return `OK: agendamento de ${appt.service.name} em ${fmtDateTime(appt.startsAt)} cancelado. Ofereça um reagendamento.`;
    }

    case "escalar_para_humano": {
      ctx.result.escalated = true;
      ctx.result.escalationReason = String(input?.motivo ?? "sem motivo informado");
      if (!dryRun) {
        const conversation = await prisma.conversation.findUnique({
          where: { contactId: contact.id },
        });
        if (conversation) {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: "HUMANO" },
          });
        }
        await notify(
          tenant.id,
          "ESCALADO",
          "IA pediu apoio",
          `${contact.name ?? contact.phone}: ${ctx.result.escalationReason}`,
        );
      } else {
        ctx.result.sandboxNotes.push("Escalação simulada (modo teste).");
      }
      return "OK: conversa transferida. Avise o lead que alguém da equipe continua o atendimento em breve.";
    }

    default:
      return `Ferramenta desconhecida: ${name}`;
  }
}

async function buildSystemPrompt(tenant: Tenant, contact: Contact): Promise<string> {
  const knowledge = await prisma.knowledgeItem.findMany({ where: { tenantId: tenant.id } });
  const now = new Date();
  const days: Record<string, string> = {
    "0": "domingo", "1": "segunda", "2": "terça", "3": "quarta",
    "4": "quinta", "5": "sexta", "6": "sábado",
  };
  const scheduleDays = tenant.aiScheduleDays.split(",").map((d) => days[d.trim()] ?? d).join(", ");

  return `Você é a atendente virtual da "${tenant.name}", respondendo leads pelo WhatsApp.

Seu papel (SDR): dar boas-vindas, tirar dúvidas sobre serviços e preços, qualificar o interesse do lead e agendar o atendimento. Tom de voz: ${tenant.aiTone}. Responda sempre em português brasileiro, com mensagens curtas no estilo de WhatsApp (1 a 3 frases, no máximo um emoji ocasional).

Data e hora atual: ${now.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" })}.
Horário de atendimento da clínica: ${tenant.aiScheduleStart} às ${tenant.aiScheduleEnd}, ${scheduleDays}.

Regras obrigatórias:
- NUNCA invente preços, serviços ou horários. Use as ferramentas listar_servicos e horarios_disponiveis.
- Só crie um agendamento depois que o lead confirmar explicitamente um horário específico.
- Ofereça no máximo 3 opções de horário por vez.
- Se o lead pedir para falar com uma pessoa, reclamar, ou você não souber responder com segurança, use escalar_para_humano.
- Se o lead disser que não quer mais receber mensagens, respeite, despeça-se educadamente e use escalar_para_humano com motivo "opt-out".
- Peça o nome do lead de forma natural durante a conversa, se ainda não souber.
${contact.name ? `\nNome do lead: ${contact.name}.` : "\nAinda não sabemos o nome do lead."}

Base de conhecimento da clínica:
${knowledge.length > 0 ? knowledge.map((k) => `### ${k.title}\n${k.content}`).join("\n\n") : "(vazia — para dúvidas fora dos serviços cadastrados, escale para humano)"}`;
}

/**
 * Roda um turno da IA SDR sobre o histórico da conversa e devolve a resposta.
 * Loop de function calling (request → executa ferramenta → devolve resultado)
 * até o modelo encerrar o turno.
 */
export async function runSdr(params: {
  tenant: Tenant;
  contact: Contact;
  history: { role: "user" | "assistant"; content: string }[];
  dryRun?: boolean;
}): Promise<SdrResult> {
  const { tenant, contact, dryRun = false } = params;
  const result: SdrResult = { reply: null, escalated: false, sandboxNotes: [] };
  const ctx: ToolCtx = { tenant, contact, dryRun, result };

  if (!env.OPENAI_API_KEY) {
    result.reply =
      "⚠️ A IA ainda não está configurada (falta a chave OPENAI_API_KEY no servidor).";
    return result;
  }

  const system = await buildSystemPrompt(tenant, contact);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
  ];

  // Loop agentico com limite de iterações
  for (let i = 0; i < 6; i++) {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      max_completion_tokens: 1024,
      messages,
      tools,
    });

    const choice = completion.choices[0];
    const message = choice?.message;
    if (!message) {
      result.reply = null;
      result.escalated = true;
      result.escalationReason = "IA não retornou resposta";
      return result;
    }

    if (message.refusal) {
      result.reply = null;
      result.escalated = true;
      result.escalationReason = "IA recusou a solicitação (política de segurança)";
      return result;
    }

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      result.reply = message.content?.trim() || null;
      return result;
    }

    messages.push(message);

    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      let output: string;
      try {
        const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        output = await runTool(ctx, tc.function.name, args);
      } catch (err: any) {
        output = `ERRO ao executar ferramenta: ${err?.message ?? "desconhecido"}`;
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: output });
    }
  }

  // Limite de iterações atingido — devolve algo seguro
  result.reply =
    "Só um instante, vou confirmar essa informação com a equipe e já te retorno! 😊";
  result.escalated = true;
  result.escalationReason = "IA excedeu o limite de passos do turno";
  return result;
}
