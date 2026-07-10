// Em produção (Cloudflare Pages), defina VITE_API_URL apontando pro backend
// na Hetzner (ex: https://api.seudominio.com.br). Em dev, o proxy do Vite
// redireciona /api para localhost:3333.
const BASE = import.meta.env.VITE_API_URL ?? "/api";

export function getToken(): string | null {
  return localStorage.getItem("alo_token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("alo_token", token);
  else localStorage.removeItem("alo_token");
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !path.startsWith("/auth/")) {
    setToken(null);
    window.location.href = "/login";
    throw new ApiError(401, "Sessão expirada");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as any)?.error ?? "Erro inesperado");
  }
  return data as T;
}

export const fmtPrice = (cents: number) =>
  `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export const fmtRelative = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d`;
};
