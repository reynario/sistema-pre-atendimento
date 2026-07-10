# Alô — Pré-atendimento com IA para clínicas

SaaS multi-tenant em que uma IA atua como SDR no WhatsApp: qualifica leads, responde
dúvidas sobre serviços e preços, agenda na agenda nativa, envia lembretes e follow-ups
automáticos, e organiza tudo num mini CRM. Escopo completo em [ESCOPO.md](ESCOPO.md);
protótipo visual em [PROTOTIPO.html](PROTOTIPO.html).

## Estrutura

```
backend/    API Fastify + TypeScript · Prisma/PostgreSQL · BullMQ/Redis · IA (OpenAI) · UazAPI
frontend/   React + Vite + Tailwind · PWA mobile-first · deploy no Cloudflare Pages
deploy/     portainer-stack.yml — stack de produção (Hetzner: Portainer + Traefik)
docker-compose.yml   Postgres + Redis para desenvolvimento local
```

## Rodando localmente

Pré-requisitos: Node 20+, Docker.

```bash
# 1. Suba Postgres e Redis
docker compose up -d

# 2. Backend
cd backend
copy .env.example .env        # preencha OPENAI_API_KEY (e UAZAPI_BASE_URL se tiver)
npm install
npx prisma migrate dev --name init
npm run dev                   # API em http://localhost:3333

# 3. Frontend (outro terminal)
cd frontend
npm install
npm run dev                   # abre http://localhost:5173 (proxy /api -> :3333)
```

Crie uma conta em `/cadastro`, cadastre serviços em **Serviços**, alimente a base de
conhecimento em **Minha IA** e teste a atendente no **Playground** — o playground
funciona sem UazAPI, só precisa da `OPENAI_API_KEY`.

## Conectando o WhatsApp (UazAPI)

1. Configure `UAZAPI_BASE_URL` no `.env` do backend (ex: `https://seusubdominio.uazapi.com`).
2. No painel da UazAPI, crie uma **instância** para a clínica e copie o token.
3. No painel do Alô, em **Minha IA**, cole o token da instância e copie a **URL do webhook**.
4. Na UazAPI, configure o webhook da instância com essa URL (eventos de mensagens).
5. Escaneie o QR code com o WhatsApp da clínica. Pronto — a IA passa a atender.

> O formato de payload de webhook varia entre versões da UazAPI. O parser em
> `backend/src/routes/webhooks.ts` (`normalizeInbound`) é tolerante, mas se as mensagens
> não chegarem, logue o body recebido e ajuste os campos lá.

## Deploy

### Backend — Hetzner (Portainer + Traefik, Docker Swarm)

A imagem do backend é buildada pelo **GitHub Actions** a cada push na `main` e
publicada em `ghcr.io/reynario/sistema-pre-atendimento:latest`
([workflow](.github/workflows/docker-image.yml)). O stack pronto — no mesmo padrão
dos seus outros projetos (rede `RNNet`, certresolver `letsencryptresolver`, labels
em `deploy:`) — está em [`deploy/portainer-stack.yml`](deploy/portainer-stack.yml):
backend + Postgres + Redis + backup diário do banco.

1. **DNS**: aponte `api.SEU-DOMINIO` para o IP do servidor.
2. No Portainer: **Stacks → Add stack**, cole o `deploy/portainer-stack.yml`.
3. Preencha as variáveis do stack:
   `POSTGRES_PASSWORD`, `JWT_SECRET`, `API_DOMAIN`, `FRONTEND_ORIGIN`,
   `OPENAI_API_KEY` (+ `UAZAPI_BASE_URL` quando for conectar o WhatsApp).
4. Deploy. As migrations rodam no start do container; o Traefik emite o
   certificado e a API fica em `https://api.SEU-DOMINIO` — HTTPS é obrigatório
   para os webhooks da UazAPI.
5. **Se a imagem no GHCR for privada**, cadastre o registry no Portainer
   (Registries → ghcr.io com um PAT `read:packages`) ou torne o pacote público
   na página do package no GitHub.
6. **Backup**: o serviço `backup` gera um dump por dia no volume `alo_backups`
   (mantém 14). Isso ainda está *dentro* do servidor — configure a sincronização
   para fora (ex: `rclone` para Cloudflare R2/S3) antes do primeiro cliente pagante.

Para atualizar a versão em produção depois de um push na main:
`docker service update --force --image ghcr.io/reynario/sistema-pre-atendimento:latest <stack>_backend`
(ou re-deploy do stack pelo Portainer).

### Frontend — Cloudflare Pages

1. Conecte o repositório no Cloudflare Pages.
2. Build config: diretório raiz `frontend`, comando `npm run build`, output `dist`.
3. Variável de ambiente: `VITE_API_URL=https://api.seudominio.com.br`.
4. O arquivo `frontend/public/_redirects` já cuida do fallback de SPA.

## O que já funciona (MVP)

- IA SDR com tool use: consulta serviços/preços reais, oferece horários livres,
  cria/confirma/cancela agendamento, escala pra humano
- Transcrição de áudio (Whisper, opcional via `OPENAI_API_KEY`)
- Debounce de mensagens picadas (8s) — a IA responde ao conjunto
- Pausa automática da IA quando um humano assume a conversa
- Follow-up de lead sumido (2 toques, depois marca como perdido)
- Lembretes de consulta (2 disparos configuráveis) com confirmação pelo chat
- Agenda nativa com anti-overbooking (transação serializável)
- Mini CRM com funil, notificações internas, playground da IA
- Multi-tenant com trial de 14 dias e escolha de plano

## Próximos passos (Fase 2)

- Billing automatizado (Asaas/Mercado Pago) e limites por plano
- Papéis de usuário (dono vs. recepção) e convites de equipe
- Relatórios (conversão, no-show, origem)
- Push notifications reais (service worker) — hoje o painel usa polling
- Lista de espera / encaixe
