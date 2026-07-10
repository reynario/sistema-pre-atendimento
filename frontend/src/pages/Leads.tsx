import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtRelative } from "../api";
import { Avatar, Empty, PageHeader, Spinner } from "../components/ui";

const STAGES = [
  { id: "NOVO", label: "Novo" },
  { id: "CONVERSANDO", label: "Conversando" },
  { id: "AGENDADO", label: "Agendado" },
  { id: "CONFIRMADO", label: "Confirmado" },
  { id: "COMPARECEU", label: "Compareceu" },
  { id: "FALTOU", label: "Faltou" },
  { id: "PERDIDO", label: "Perdido" },
] as const;

export default function Leads() {
  const [stage, setStage] = useState<string>("NOVO");
  const [funnel, setFunnel] = useState<Record<string, number>>({});
  const [items, setItems] = useState<any[] | null>(null);

  useEffect(() => {
    void api<Record<string, number>>("/contacts/funnel").then(setFunnel).catch(() => {});
  }, [stage]);

  useEffect(() => {
    setItems(null);
    void api<any[]>(`/contacts?status=${stage}`).then(setItems).catch(() => setItems([]));
  }, [stage]);

  const changeStatus = async (id: string, status: string) => {
    await api(`/contacts/${id}`, { method: "PATCH", body: { status } });
    setItems((prev) => prev?.filter((c) => c.id !== id) ?? null);
    void api<Record<string, number>>("/contacts/funnel").then(setFunnel).catch(() => {});
  };

  return (
    <div>
      <PageHeader title="Leads" subtitle="Funil do pré-atendimento" />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {STAGES.map((s) => (
          <button
            key={s.id}
            onClick={() => setStage(s.id)}
            className={`chip flex-none px-3.5 py-2 ${
              stage === s.id ? "bg-ink text-surface" : "border border-ink/10 bg-surface text-ink-muted"
            }`}
          >
            {s.label} · {funnel[s.id] ?? 0}
          </button>
        ))}
      </div>

      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty>Nenhum lead nesta etapa.</Empty>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <div key={c.id} className="card flex items-center gap-3 py-3">
              <Avatar name={c.name} phone={c.phone} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{c.name ?? c.phone}</span>
                  {c.conversation && (
                    <span className="flex-none text-[11px] text-ink-faint">
                      {fmtRelative(c.conversation.lastMessageAt)}
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink-muted">{c.phone}</div>
                {c.lostReason && <div className="mt-0.5 text-xs text-brick">{c.lostReason}</div>}
              </div>
              <div className="flex flex-none flex-col items-end gap-1.5">
                {c.conversation && (
                  <Link to={`/conversas/${c.conversation.id}`} className="text-xs font-semibold text-pine">
                    Ver conversa
                  </Link>
                )}
                <select
                  className="rounded-lg border border-ink/10 bg-surface-2 px-2 py-1 text-[11px] font-semibold text-ink-muted"
                  value={c.status}
                  onChange={(e) => void changeStatus(c.id, e.target.value)}
                >
                  {STAGES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
