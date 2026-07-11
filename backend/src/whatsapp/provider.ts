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
}

export const whatsapp: WhatsAppProvider = env.UAZAPI_BASE_URL
  ? new UazApiProvider()
  : new NoopProvider();
