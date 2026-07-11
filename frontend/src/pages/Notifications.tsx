import { useEffect, useState } from "react";
import { api, fmtRelative } from "../api";
import { Empty, PageHeader, Spinner } from "../components/ui";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** Card de ativação do web push (aparece se o servidor tiver VAPID configurado). */
function PushCard() {
  const [state, setState] = useState<"loading" | "unavailable" | "off" | "on" | "denied">("loading");

  useEffect(() => {
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return setState("unavailable");
      }
      const { enabled } = await api<{ enabled: boolean }>("/push/public-key").catch(() => ({ enabled: false }));
      if (!enabled) return setState("unavailable");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })();
  }, []);

  const enable = async () => {
    try {
      const { publicKey } = await api<{ publicKey: string }>("/push/public-key");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON();
      await api("/push/subscribe", {
        method: "POST",
        body: { endpoint: sub.endpoint, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } },
      });
      setState("on");
    } catch {
      setState("off");
    }
  };

  const disable = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
    setState("off");
  };

  if (state === "loading" || state === "unavailable") return null;

  return (
    <div className="card mb-4 flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-semibold">Avisos no celular</div>
        <div className="text-xs text-ink-muted">
          {state === "on"
            ? "Você recebe um push quando a IA pedir apoio ou algo mudar na agenda."
            : state === "denied"
              ? "Notificações bloqueadas no navegador — libere nas configurações do site."
              : "Receba um push quando a IA pedir apoio, mesmo com o painel fechado."}
        </div>
      </div>
      {state !== "denied" && (
        <button
          className={`chip flex-none px-3.5 py-2 ${state === "on" ? "border border-ink/15 text-ink-muted" : "bg-pine text-white"}`}
          onClick={() => void (state === "on" ? disable() : enable())}
        >
          {state === "on" ? "Desativar" : "Ativar"}
        </button>
      )}
    </div>
  );
}

const ICONS: Record<string, string> = {
  ESCALADO: "⚠️",
  AGENDAMENTO: "📅",
  CANCELAMENTO: "✖️",
  CONFIRMACAO: "✅",
  FOLLOWUP: "💬",
  ASSINATURA: "💳",
  WHATSAPP: "📵",
};

export default function Notifications() {
  const [items, setItems] = useState<any[] | null>(null);

  useEffect(() => {
    void api<any[]>("/notifications")
      .then(async (data) => {
        setItems(data);
        await api("/notifications/read-all", { method: "POST" }).catch(() => {});
      })
      .catch(() => setItems([]));
  }, []);

  return (
    <div>
      <PageHeader title="Notificações" subtitle="O que aconteceu enquanto você não olhava" />
      <PushCard />
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty>Nenhum aviso por enquanto.</Empty>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <div key={n.id} className={`card flex items-start gap-3 py-3 ${n.readAt ? "" : "border-pine/40"}`}>
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-pine-tint text-base">
                {ICONS[n.type] ?? "🔔"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{n.title}</span>
                  <span className="flex-none text-[11px] text-ink-faint">{fmtRelative(n.createdAt)}</span>
                </div>
                <div className="text-xs text-ink-muted">{n.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
