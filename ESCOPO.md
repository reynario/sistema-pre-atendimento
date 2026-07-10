# Sistema de Pré-Atendimento com IA — Escopo do Produto

## 1. Problema que resolve

Clínicas (e negócios similares baseados em agendamento) perdem leads porque:
- O atendimento via WhatsApp é manual, lento e consome tempo da recepção/dono.
- Não há separação entre "curioso" e lead realmente interessado — todo mundo recebe o mesmo esforço de atendimento.
- Não existe visão consolidada de quem está em qual etapa do funil (conversando, agendado, sumiu).
- Lembretes de consulta, quando existem, são manuais.

## 2. Pitch

Um SaaS de pré-atendimento com IA que atua como um SDR virtual no WhatsApp: qualifica o lead, responde dúvidas sobre serviços e preços, agenda direto na agenda nativa do sistema, envia lembretes automáticos e organiza tudo num mini CRM — para que a recepção só precise agir quando o lead já está qualificado e agendado.

## 3. Público-alvo

Clínicas e negócios pequenos/médios baseados em agendamento (estética, saúde, terapias, salões etc.), geralmente sem equipe técnica, que hoje fazem tudo manualmente pelo WhatsApp.

## 4. Arquitetura recomendada

| Camada | Escolha | Por quê |
|---|---|---|
| Canal WhatsApp | **UazAPI** (serviço hospedado, baseado em Baileys, multi-instância) | Não precisa self-host: cada clínica conecta seu número via QR Code numa instância gerenciada pela UazAPI. Custo por instância (mensal), mas remove a complexidade operacional de manter conexão WhatsApp ativa. Risco aceito: número pode ser bloqueado pela Meta em uso muito agressivo — mitigar com rate-limiting e comportamento humano (delays, "digitando..."). |
| Frontend | **Next.js (React) + Tailwind**, PWA instalável | Mobile-first nativo via responsividade, funciona bem em desktop, PWA permite "instalar" no celular sem precisar de loja de apps — ideal pro público leigo. |
| Backend | **Node.js/TypeScript (NestJS ou Fastify)** | Mesma linguagem do frontend (produtividade), consome a UazAPI via REST/webhook, fácil achar libs de fila/agendamento. |
| Banco de dados | **PostgreSQL** | Multi-tenant via `tenant_id` em cada tabela (mais simples de operar que schema-per-tenant no início). |
| IA conversacional | **Claude ou GPT via API**, com base de conhecimento por tenant (serviços, preços, FAQ, horários) injetada no prompt/RAG | Cada clínica tem seu próprio "cérebro" de atendimento, sem vazar dados entre tenants. |
| Filas/Lembretes | **BullMQ + Redis** | Agendar envio de lembretes X horas antes, retries, jobs recorrentes. |
| Pagamentos (planos) | **Asaas ou Mercado Pago** (assinatura recorrente com Pix/boleto/cartão) | Gateways nacionais com suporte forte a cobrança recorrente e Pix, comuns em SaaS B2B brasileiro. |
| Hospedagem | Frontend no **Cloudflare Pages**; backend + Postgres + Redis num **servidor Hetzner** (via Docker Compose) | Cloudflare Pages serve o Next.js com CDN global e custo zero no início. O Hetzner roda o backend com processo persistente, banco e Redis na mesma máquina — barato e sob seu controle. Requisitos: domínio com HTTPS (Caddy ou Nginx + Let's Encrypt) para receber os webhooks da UazAPI, e rotina de backup do Postgres (ex: dump diário para object storage). |

## 5. Módulos e funcionalidades

### 5.1 IA Atendente (SDR virtual)
- Recebe mensagem do lead via WhatsApp (webhook da UazAPI).
- Responde com base na base de conhecimento da clínica (serviços, preços, horários, políticas).
- Faz perguntas de qualificação (o que procura, urgência, já é cliente, etc.).
- Consulta a agenda em tempo real e oferece horários livres.
- Fecha o agendamento diretamente no chat quando possível.
- Escala para atendimento humano quando identifica ambiguidade, reclamação ou pedido explícito de falar com alguém.
- Cada interação é logada no CRM automaticamente (sem digitação manual da recepção).
- **Transcreve áudios recebidos** (Whisper ou similar) — no Brasil, boa parte dos leads manda voz, não texto; sem isso a IA "trava" logo na primeira mensagem.
- **Agrupa mensagens picadas (debounce)**: lead manda 3-4 mensagens curtas em sequência; a IA espera alguns segundos e responde ao conjunto, não a cada linha.
- **Pausa automática quando um humano assume**: ao clicar em "Assumir" (ou se a recepção responder pelo painel), a IA silencia naquela conversa até ser reativada.
- **Horário de funcionamento da IA configurável**: fora do expediente ela pode responder normalmente, só coletar dados, ou avisar que retorna no horário comercial.
- **Follow-up automático de lead que sumiu**: se o lead parou de responder no meio da conversa, a IA reengaja depois de X horas/dias (1-2 tentativas, com tom leve). É o ataque direto à dor original: "cliente some".

### 5.1.1 Base de conhecimento e modo de teste
- Editor simples da base de conhecimento: FAQ, políticas, diferenciais da clínica — em linguagem natural, sem precisar entender de "prompt".
- **Playground/modo teste**: a clínica conversa com a própria IA dentro do painel antes de ativar no número real — essencial pra dar confiança a um público leigo.

### 5.2 Agenda / Calendário nativo
- Clínica configura dias e horários disponíveis para triagem, por profissional/sala.
- Duração do slot calculada a partir do serviço escolhido.
- Bloqueios manuais (folgas, feriados, imprevistos).
- Regras de antecedência mínima/máxima para agendamento.
- Visualização em lista e em calendário (dia/semana), mobile-first.

### 5.3 Mini CRM
- Funil de status: `Novo → Conversando → Agendado → Confirmado → Compareceu / Não compareceu → Perdido`.
- Ficha do contato com histórico completo da conversa com a IA.
- Tags manuais/automáticas (ex: "curioso", "quente", "recorrente").
- Motivo de perda (para a clínica entender onde o funil vaza).
- Busca e filtros simples.

### 5.4 Catálogo de serviços e preços
- Nome, descrição curta, duração, preço, profissional responsável.
- Serve de fonte de verdade tanto para a IA responder preços quanto para a agenda calcular duração do slot.

### 5.5 Lembretes automáticos
- Envio automático via WhatsApp X horas ou 1 dia antes da consulta (configurável pela clínica).
- Botões/respostas rápidas: confirmar, cancelar, reagendar — tudo resolvido no próprio chat, sem intervenção humana no caso feliz.
- Registro manual de comparecimento/falta pela recepção (alimenta o funil e o relatório de no-show).
- Política de cancelamento configurável (antecedência mínima pra cancelar/reagendar pelo chat).

### 5.5.1 Notificações para a equipe
- Notificação push (PWA) ou aviso no WhatsApp da recepção quando: a IA escala uma conversa, um agendamento é criado/cancelado, ou um lead confirma presença.
- Sem isso, a recepção precisa ficar com o painel aberto o dia inteiro — e o valor do "só agir quando precisa" se perde.

### 5.6 Multi-tenant / SaaS
- Cadastro de clínica (onboarding: nome, WhatsApp, serviços iniciais, horários).
- Planos: mensal, trimestral, anual (com desconto crescente).
- **Teste grátis (trial)** de 7-14 dias sem cartão — reduz muito a barreira de entrada pra esse público.
- **Limites por plano** como diferenciadores (ex: nº de conversas de IA/mês, nº de usuários, nº de profissionais na agenda) — sem isso não há razão pra existir mais de um preço além do ciclo de cobrança.
- Comportamento pós-inadimplência definido (ex: avisos → IA pausa → dados preservados por 30 dias).
- Isolamento total de dados entre clínicas.
- Painel de billing (status do plano, próxima cobrança, upgrade/downgrade).
- **Papéis de usuário**: dono (vê tudo, mexe em plano e configurações) vs. recepção (opera conversas, agenda e CRM).
- **LGPD básico**: opt-out do lead ("não quero mais receber mensagens" interrompe follow-ups e lembretes), e exportação/exclusão de dados de contato sob pedido.

### 5.7 Simplicidade de uso
- Onboarding guiado passo a passo na primeira vez.
- Telas com poucas ações por vez, linguagem simples, sem jargão técnico.
- Ações mais usadas (ver agenda do dia, ver leads novos) na tela inicial.

## 6. Entidades principais (modelo de dados, alto nível)

- `Tenant` (clínica): dados cadastrais, plano, status de assinatura.
- `User`: usuários do sistema (dono, recepção), vinculados a um tenant.
- `Contact` (lead/cliente): dados do WhatsApp, histórico, status no funil, tags.
- `Conversation` / `Message`: histórico de mensagens trocadas com a IA (e com humano, se escalado).
- `Service`: serviço oferecido, duração, preço, profissional.
- `Professional`/`Room` (opcional no MVP): quem/onde o serviço é realizado.
- `Appointment`: agendamento (contato, serviço, profissional, data/hora, status).
- `AvailabilityRule`: regras de horário disponível por profissional/tenant.
- `Reminder`: lembretes agendados vinculados a um `Appointment`.
- `FollowUp`: reengajamentos agendados para leads que pararam de responder.
- `KnowledgeBase`: FAQ, políticas e textos livres que alimentam a IA do tenant.
- `Notification`: avisos para a equipe (IA escalou, agendamento criado/cancelado).
- `Plan`/`Subscription`: plano contratado, ciclo de cobrança, status de pagamento, trial e limites de uso.

## 7. Fluxo do lead (ponta a ponta)

1. Lead manda mensagem no WhatsApp da clínica.
2. UazAPI recebe → webhook → backend cria/atualiza `Contact` e `Conversation`.
3. IA responde usando base de conhecimento do tenant, qualifica o lead.
4. IA consulta `AvailabilityRule` + `Appointment`s existentes → oferece horários.
5. Lead confirma → `Appointment` criado, `Contact.status = Agendado`.
6. Job agendado dispara lembrete X horas/1 dia antes.
7. Lead confirma/cancela/reagenda pelo próprio chat → atualiza `Appointment`.
8. Recepção acompanha tudo pelo painel (CRM + Agenda), só intervém quando a IA escala.

## 8. Fases

**MVP (Fase 1)**
- IA SDR com qualificação e agendamento básico (1 canal, 1 base de conhecimento por tenant).
- Transcrição de áudio + debounce de mensagens picadas (sem isso a IA falha no uso real brasileiro).
- Pausa da IA quando humano assume a conversa.
- Follow-up automático simples (1 reengajamento de lead que sumiu).
- Agenda nativa simples (sem multi-profissional avançado).
- CRM com funil básico.
- Catálogo de serviços/preços.
- Lembrete automático (1 disparo por consulta).
- Notificação pra recepção quando a IA escala.
- Playground pra clínica testar a própria IA antes de ativar.
- Cadastro de clínica + trial + planos (pode começar com cobrança manual/gerada por link, antes de automatizar 100% o billing).

**Fase 2**
- Multi-profissional/multi-sala na agenda.
- Reagendamento automático inteligente.
- Sequência de follow-up configurável (múltiplos toques, horários).
- Mensagem pós-consulta (agradecimento, pedido de avaliação no Google, oferta de retorno).
- Billing 100% automatizado (assinatura recorrente via gateway) + limites por plano aplicados.
- Papéis de usuário (dono vs. recepção).
- Relatórios (taxa de conversão, no-show, origem do lead).
- Lista de espera / encaixe quando um horário vaga.

**Fase 3**
- Múltiplos canais além do WhatsApp (Instagram DM, site).
- App mobile nativo (se a PWA não for suficiente).
- IA com voz/áudio.

## 9. Riscos e pontos de atenção

- **Bloqueio de número**: UazAPI (como qualquer solução baseada em Baileys) não é um canal oficial da Meta — mitigar com uso moderado, delays humanizados, e ter um plano de migração para a API oficial da Meta se algum cliente crescer muito.
- **Dependência de terceiro**: por ser um serviço hospedado, instabilidade ou mudança de preço da UazAPI afeta diretamente o produto — vale ter um adaptador isolado no backend para trocar de provedor com menor esforço se necessário.
- **Qualidade da IA**: respostas erradas sobre preço/agenda geram atrito — validar bem o prompt e ter fallback claro para humano.
- **Dado sensível de saúde**: se atender clínicas de saúde, considerar LGPD com mais rigor (dados podem ser sensíveis).
- **Concorrência de agendamento**: dois leads negociando o mesmo horário ao mesmo tempo — a criação do `Appointment` precisa de lock/transação pra nunca gerar overbooking.
- **Custo variável de IA**: cada conversa consome tokens (e transcrição de áudio consome mais) — monitorar custo por tenant desde o dia 1 pra precificar os planos com margem real.
- **Servidor único (Hetzner)**: backend, banco e Redis na mesma máquina = ponto único de falha. Aceitável pra teste/início, mas ter backup diário do Postgres fora do servidor é inegociável antes de ter cliente pagante.

## 10. Próximos passos sugeridos

1. Validar este escopo com você (cortar/adicionar algo do MVP).
2. Desenhar as telas principais (mobile-first) antes de codar.
3. Estruturar o projeto (monorepo: `frontend/`, `backend/`; UazAPI é serviço externo, consumido via API/webhook, sem infraestrutura própria pra WhatsApp).
