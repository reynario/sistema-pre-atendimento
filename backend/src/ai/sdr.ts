import OpenAI from "openai";
import type { Tenant, Contact } from "@prisma/client";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { getFreeSlots, createAppointmentSafe } from "../core/slots.js";
import { scheduleReminders, cancelReminders } from "../core/reminders.js";
import { notify } from "../core/notify.js";
import { jobsQueue } from "../queues.js";

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

const tools: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    strict: false,
    name: "listar_servicos",
    description:
      "Lista os serviços oferecidos pela clínica com preço, duração e profissional. Use antes de informar qualquer preço.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    strict: false,
    name: "listar_profissionais",
    description:
      "Lista os profissionais da clínica. Use para perguntar ao lead se ele prefere um profissional específico ou se pode ser qualquer um.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    strict: false,
    name: "horarios_disponiveis",
    description:
      "Consulta os horários livres de um dia para um serviço. Use sempre que o lead quiser agendar — nunca invente horários.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data no formato YYYY-MM-DD" },
        servico_id: { type: "string", description: "ID do serviço (de listar_servicos)" },
        profissional_id: {
          type: "string",
          description:
            "ID do profissional (de listar_profissionais), apenas se o lead preferir um específico",
        },
      },
      required: ["data", "servico_id"],
    },
  },
  {
    type: "function",
    strict: false,
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
        profissional_id: {
          type: "string",
          description: "ID do profissional escolhido, se o lead preferiu um específico",
        },
        nome_cliente: { type: "string", description: "Nome do lead, se ele informou" },
      },
      required: ["servico_id", "data_hora"],
    },
  },
  {
    type: "function",
    strict: false,
    name: "confirmar_agendamento",
    description: "Confirma a presença do lead no próximo agendamento dele (resposta a lembrete).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    strict: false,
    name: "cancelar_agendamento",
    description: "Cancela o próximo agendamento do lead, a pedido dele.",
    parameters: {
      type: "object",
      properties: { motivo: { type: "string" } },
      required: [],
    },
  },
  {
    type: "function",
    strict: false,
    name: "entrar_lista_espera",
    description:
      "Coloca o lead na lista de espera quando nenhum horário disponível serve pra ele. Se um horário vagar, ele é avisado automaticamente.",
    parameters: {
      type: "object",
      properties: {
        servico_id: { type: "string", description: "ID do serviço desejado, se souber" },
        observacao: { type: "string", description: "Preferência do lead (ex: 'só de manhã')" },
      },
      required: [],
    },
  },
  {
    type: "function",
    strict: false,
    name: "escalar_para_humano",
    description:
      "Transfere a conversa para a equipe humana. Use quando: o lead pedir para falar com uma pessoa, houver reclamação, ou você não souber responder com segurança.",
    parameters: {
      type: "object",
      properties: { motivo: { type: "string", description: "Resumo curto do motivo" } },
      required: ["motivo"],
    },
  },
];

/**
 * Resolve o serviço a partir do que o modelo mandar: id exato ou, como
 * fallback, nome aproximado — modelos menores às vezes passam o nome do
 * serviço no lugar do id, e isso não pode derrubar a ferramenta com uma
 * exceção do Prisma (era a causa de "não consegui verificar os horários").
 */
async function resolveService(tenantId: string, idOrName: unknown) {
  const raw = String(idOrName ?? "").trim();
  if (!raw) return null;
  const byId = await prisma.service.findFirst({
    where: { id: raw, tenantId, active: true },
  });
  if (byId) return byId;
  return prisma.service.findFirst({
    where: { tenantId, active: true, name: { contains: raw, mode: "insensitive" } },
  });
}

const SERVICO_NAO_ENCONTRADO =
  "ERRO: serviço não encontrado. Chame listar_servicos e use o valor exato do campo id.";

/** Mesma lógica tolerante do resolveService, para profissionais. */
async function resolveProfessional(tenantId: string, idOrName: unknown) {
  const raw = String(idOrName ?? "").trim();
  if (!raw) return null;
  const byId = await prisma.professional.findFirst({ where: { id: raw, tenantId } });
  if (byId) return byId;
  return prisma.professional.findFirst({
    where: { tenantId, name: { contains: raw, mode: "insensitive" } },
  });
}

const PROFISSIONAL_NAO_ENCONTRADO =
  "ERRO: profissional não encontrado. Chame listar_profissionais e use o valor exato do campo id, ou omita para qualquer profissional.";

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

    case "listar_profissionais": {
      const professionals = await prisma.professional.findMany({
        where: { tenantId: tenant.id },
      });
      if (professionals.length === 0)
        return "Nenhum profissional cadastrado — não pergunte por preferência de profissional.";
      return professionals.map((p) => `id=${p.id} | ${p.name}`).join("\n");
    }

    case "horarios_disponiveis": {
      const service = await resolveService(tenant.id, input.servico_id);
      if (!service) return SERVICO_NAO_ENCONTRADO;

      let professionalId: string | null = null;
      if (input.profissional_id) {
        const professional = await resolveProfessional(tenant.id, input.profissional_id);
        if (!professional) return PROFISSIONAL_NAO_ENCONTRADO;
        professionalId = professional.id;
      }

      const date = String(input.data ?? "").trim();
      let slots;
      try {
        slots = await getFreeSlots({ tenantId: tenant.id, date, serviceId: service.id, professionalId });
      } catch {
        return "ERRO: data inválida. Use o formato YYYY-MM-DD.";
      }
      if (slots.length === 0) {
        // Dia sem grade cadastrada ≠ dia lotado: a IA precisa saber a diferença
        // para não dizer "está tudo ocupado" quando a clínica nem abre.
        const weekday = new Date(`${date}T00:00:00`).getDay();
        const hasRules = await prisma.availabilityRule.count({
          where: { tenantId: tenant.id, weekday },
        });
        return hasRules > 0
          ? "Nenhum horário livre nesse dia. Sugira outro dia ao lead."
          : "A clínica não atende nesse dia da semana. Sugira um dia em que ela abre (veja o horário de atendimento).";
      }
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
      const service = await resolveService(tenant.id, input.servico_id);
      if (!service) return SERVICO_NAO_ENCONTRADO;

      let professionalId: string | null = null;
      if (input.profissional_id) {
        const professional = await resolveProfessional(tenant.id, input.profissional_id);
        if (!professional) return PROFISSIONAL_NAO_ENCONTRADO;
        professionalId = professional.id;
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
          serviceId: service.id,
          professionalId,
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
        // Horário vagou: aciona a lista de espera
        await jobsQueue.add("process-waitlist", {
          kind: "process-waitlist",
          tenantId: tenant.id,
          appointmentId: appt.id,
        });
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

    case "entrar_lista_espera": {
      if (dryRun) {
        ctx.result.sandboxNotes.push("Entrada na lista de espera simulada (modo teste).");
        return "SIMULADO: lead adicionado à lista de espera.";
      }
      const existing = await prisma.waitlistEntry.findFirst({
        where: { tenantId: tenant.id, contactId: contact.id, status: "PENDENTE" },
      });
      if (existing) return "Este lead já está na lista de espera.";
      // servico_id inválido não pode impedir a entrada na lista (era a causa
      // da falha "probleminha para te colocar na lista de espera"): sem
      // serviço resolvido, entra sem serviço e o desejo do lead vai nas notas.
      const service = await resolveService(tenant.id, input?.servico_id);
      const wanted =
        !service && input?.servico_id ? `Serviço desejado: ${String(input.servico_id)}` : null;
      const notes = [wanted, input?.observacao ? String(input.observacao) : null]
        .filter(Boolean)
        .join(" — ");
      await prisma.waitlistEntry.create({
        data: {
          tenantId: tenant.id,
          contactId: contact.id,
          serviceId: service?.id ?? null,
          notes: notes || null,
        },
      });
      await notify(
        tenant.id,
        "AGENDAMENTO",
        "Lead na lista de espera",
        `${contact.name ?? contact.phone} entrou na lista de espera` +
          (input?.observacao ? ` (${input.observacao})` : "") + ".",
      );
      return "OK: lead adicionado à lista de espera. Avise que ele será chamado assim que vagar um horário.";
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

Fluxo de agendamento — siga nesta ordem, fazendo UMA pergunta por vez:
1. Pergunte qual serviço o lead deseja (consulte listar_servicos; se houver só um serviço, apenas confirme).
2. Se a clínica tiver mais de um profissional (listar_profissionais), pergunte se o lead prefere algum específico ou se pode ser qualquer um. Com um só profissional, não pergunte.
3. Pergunte o dia desejado e consulte horarios_disponiveis; ofereça até 3 opções.
4. Se ainda não souber o nome do lead, pergunte antes de fechar o agendamento.
5. Com horário confirmado explicitamente pelo lead, use criar_agendamento.

Regras obrigatórias:
- NUNCA invente preços, serviços ou horários. Use as ferramentas listar_servicos e horarios_disponiveis.
- NUNCA presuma qual serviço o lead quer — pergunte, mesmo que ele já tenha vindo pedindo horário.
- Só crie um agendamento depois que o lead confirmar explicitamente um horário específico.
- Ofereça no máximo 3 opções de horário por vez.
- Se nenhum horário disponível servir para o lead, ofereça colocá-lo na lista de espera (entrar_lista_espera) — ele será avisado quando vagar.
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

  const instructions = await buildSystemPrompt(tenant, contact);
  const input: OpenAI.Responses.ResponseInputItem[] = params.history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Modelos de raciocínio (gpt-5.x, o*) exigem o parâmetro `reasoning` e não
  // aceitam function tools no chat/completions — por isso a Responses API.
  // Modelos clássicos (gpt-4o*) não aceitam `reasoning`, então é condicional.
  const isReasoningModel = /^(gpt-5|o\d)/i.test(env.OPENAI_MODEL);

  // Consumo de tokens do turno inteiro (todas as iterações do loop)
  let usedInput = 0;
  let usedOutput = 0;
  const recordUsage = async () => {
    if (usedInput + usedOutput === 0) return;
    await prisma.aiUsage
      .create({
        data: {
          tenantId: tenant.id,
          model: env.OPENAI_MODEL,
          inputTokens: usedInput,
          outputTokens: usedOutput,
          source: dryRun ? "playground" : "whatsapp",
        },
      })
      .catch(() => {});
  };

  // Loop agentico com limite de iterações
  for (let i = 0; i < 6; i++) {
    const response = await client.responses.create({
      model: env.OPENAI_MODEL,
      instructions,
      input,
      tools,
      // Reasoning consome parte do limite de saída, então a folga é maior
      // que os 1024 da era chat/completions.
      max_output_tokens: 2048,
      ...(isReasoningModel ? { reasoning: { effort: "low" as const } } : {}),
    });

    usedInput += response.usage?.input_tokens ?? 0;
    usedOutput += response.usage?.output_tokens ?? 0;

    const refused = response.output.some(
      (item) => item.type === "message" && item.content.some((c) => c.type === "refusal"),
    );
    if (refused) {
      result.reply = null;
      result.escalated = true;
      result.escalationReason = "IA recusou a solicitação (política de segurança)";
      await recordUsage();
      return result;
    }

    const functionCalls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call",
    );
    if (functionCalls.length === 0) {
      result.reply = response.output_text.trim() || null;
      if (result.reply === null) {
        result.escalated = true;
        result.escalationReason = "IA não retornou resposta";
      }
      await recordUsage();
      return result;
    }

    // Devolve a saída inteira (inclusive itens de raciocínio, obrigatórios
    // para modelos reasoning) e os resultados de cada ferramenta. O cast é
    // necessário porque a union de saída do SDK é mais larga que a de entrada
    // (itens de computer-use, que este agente não usa).
    input.push(...(response.output as OpenAI.Responses.ResponseInputItem[]));

    for (const fc of functionCalls) {
      let output: string;
      try {
        const args = fc.arguments ? JSON.parse(fc.arguments) : {};
        output = await runTool(ctx, fc.name, args);
      } catch (err: any) {
        output = `ERRO ao executar ferramenta: ${err?.message ?? "desconhecido"}`;
      }
      input.push({ type: "function_call_output", call_id: fc.call_id, output });
    }
  }

  // Limite de iterações atingido — devolve algo seguro
  result.reply =
    "Só um instante, vou confirmar essa informação com a equipe e já te retorno! 😊";
  result.escalated = true;
  result.escalationReason = "IA excedeu o limite de passos do turno";
  await recordUsage();
  return result;
}
