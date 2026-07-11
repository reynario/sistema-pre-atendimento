import type { Tenant } from "@prisma/client";
import { env } from "../env.js";

/**
 * Adaptador de WhatsApp. A UazAPI é a implementação atual; se um dia for
 * preciso trocar de provedor (Evolution, API oficial da Meta...), só este
 * arquivo muda — o resto do sistema fala com esta interface.
 */
export interface WhatsAppProvider {
  sendText(tenant: Tenant, phone: string, text: string): Promise<void>;
  /** Status da conexão da instância + QR code quando desconectada. */
  getStatus(tenant: Tenant): Promise<{ connected: boolean; qrcode?: string }>;
  /** Desconecta a sessão do WhatsApp na instância (para trocar de número). */
  disconnect(tenant: Tenant): Promise<void>;
  /** Cria uma instância nova via token admin e retorna o token dela. */
  createInstance(name: string): Promise<string>;
  /** Configura a URL de webhook da instância (eventos de mensagens). */
  configureWebhook(tenant: Tenant, url: string): Promise<void>;
  /** Inicia o pareamento e retorna o QR code (se disponível de imediato). */
  connect(tenant: Tenant): Promise<{ qrcode?: string }>;
}

function baseUrl(): string {
  if (!env.UAZAPI_BASE_URL) throw new Error("UAZAPI_BASE_URL não configurada");
  return env.UAZAPI_BASE_URL.replace(/\/$/, "");
}

function tenantToken(tenant: Tenant): string {
  if (!tenant.uazapiToken) throw new Error("Clínica sem token de instância UazAPI");
  return tenant.uazapiToken;
}

class UazApiProvider implements WhatsAppProvider {
  async sendText(tenant: Tenant, phone: string, text: string): Promise<void> {
    // Pequeno delay humanizado antes de enviar (mitiga risco de bloqueio)
    await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1500));

    const res = await fetch(`${baseUrl()}/send/text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: tenantToken(tenant),
      },
      body: JSON.stringify({ number: phone, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`UazAPI /send/text falhou (${res.status}): ${body.slice(0, 300)}`);
    }
  }

  async createInstance(name: string): Promise<string> {
    if (!env.UAZAPI_ADMIN_TOKEN) {
      throw new Error("UAZAPI_ADMIN_TOKEN não configurado no servidor");
    }
    const res = await fetch(`${baseUrl()}/instance/init`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        admintoken: env.UAZAPI_ADMIN_TOKEN,
      },
      body: JSON.stringify({ name }),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new Error(
        `UazAPI /instance/init falhou (${res.status}): ${JSON.stringify(data).slice(0, 300)}`,
      );
    }
    const token: string | undefined =
      data?.token ?? data?.instance?.token ?? data?.instance?.apikey;
    if (!token) {
      throw new Error(`UazAPI /instance/init não retornou token: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return token;
  }

  async configureWebhook(tenant: Tenant, url: string): Promise<void> {
    const body = JSON.stringify({
      enabled: true,
      url,
      events: ["messages"],
      excludeMessages: ["wasSentByApi"],
    });
    const headers = { "Content-Type": "application/json", token: tenantToken(tenant) };

    // O verbo varia entre versões da UazAPI — tenta POST e cai pra PUT
    let res = await fetch(`${baseUrl()}/webhook`, { method: "POST", headers, body });
    if (!res.ok && res.status !== 200) {
      res = await fetch(`${baseUrl()}/webhook`, { method: "PUT", headers, body });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`UazAPI /webhook falhou (${res.status}): ${text.slice(0, 300)}`);
    }
  }

  async connect(tenant: Tenant): Promise<{ qrcode?: string }> {
    const res = await fetch(`${baseUrl()}/instance/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: tenantToken(tenant) },
      body: JSON.stringify({}),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new Error(
        `UazAPI /instance/connect falhou (${res.status}): ${JSON.stringify(data).slice(0, 300)}`,
      );
    }
    const qrcode: string | undefined =
      data?.instance?.qrcode ?? data?.qrcode ?? undefined;
    return { qrcode };
  }

  async disconnect(tenant: Tenant): Promise<void> {
    const res = await fetch(`${baseUrl()}/instance/disconnect`, {
      method: "POST",
      headers: { token: tenantToken(tenant) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`UazAPI /instance/disconnect falhou (${res.status}): ${body.slice(0, 200)}`);
    }
  }

  async getStatus(tenant: Tenant): Promise<{ connected: boolean; qrcode?: string }> {
    const res = await fetch(`${baseUrl()}/instance/status`, {
      headers: { token: tenantToken(tenant) },
    });
    if (!res.ok) return { connected: false };
    const data = (await res.json().catch(() => ({}))) as any;
    const status: string =
      data?.instance?.status ?? data?.status ?? data?.state ?? "unknown";
    const connected = ["connected", "open", "CONNECTED"].includes(status);
    const qrcode: string | undefined =
      data?.instance?.qrcode ?? data?.qrcode ?? undefined;
    return { connected, qrcode };
  }
}

/** Provedor "nulo" para ambiente sem UazAPI configurada (dev/testes). */
class NoopProvider implements WhatsAppProvider {
  async sendText(tenant: Tenant, phone: string, text: string): Promise<void> {
    console.log(`[whatsapp:noop] para ${phone} (${tenant.slug}): ${text}`);
  }
  async getStatus(): Promise<{ connected: boolean }> {
    return { connected: false };
  }
  async disconnect(): Promise<void> {}
  async createInstance(): Promise<string> {
    throw new Error("UAZAPI_BASE_URL não configurada no servidor");
  }
  async configureWebhook(): Promise<void> {}
  async connect(): Promise<{ qrcode?: string }> {
    throw new Error("UAZAPI_BASE_URL não configurada no servidor");
  }
}

export const whatsapp: WhatsAppProvider = env.UAZAPI_BASE_URL
  ? new UazApiProvider()
  : new NoopProvider();
