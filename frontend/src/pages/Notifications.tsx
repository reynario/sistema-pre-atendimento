import { useEffect, useState } from "react";
import { api, fmtRelative } from "../api";
import { Empty, PageHeader, Spinner } from "../components/ui";

const ICONS: Record<string, string> = {
  ESCALADO: "⚠️",
  AGENDAMENTO: "📅",
  CANCELAMENTO: "✖️",
  CONFIRMACAO: "✅",
  FOLLOWUP: "💬",
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
