import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtRelative } from "../api";
import { Avatar, Empty, PageHeader, Spinner, StatusChip } from "../components/ui";

const FILTERS = [
  { id: "", label: "Todas" },
  { id: "IA", label: "IA respondendo" },
  { id: "HUMANO", label: "Aguardam você" },
] as const;

export default function Conversations() {
  const [filter, setFilter] = useState("");
  const [items, setItems] = useState<any[] | null>(null);

  useEffect(() => {
    setItems(null);
    void api<any[]>(`/conversations${filter ? `?status=${filter}` : ""}`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [filter]);

  return (
    <div>
      <PageHeader title="Conversas" />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`chip flex-none px-3.5 py-2 ${
              filter === f.id ? "bg-ink text-surface" : "border border-ink/10 bg-surface text-ink-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty>Nenhuma conversa por aqui ainda. Quando um lead mandar mensagem no WhatsApp, ela aparece nesta lista.</Empty>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <Link key={c.id} to={`/conversas/${c.id}`} className="card flex items-center gap-3 py-3 transition hover:border-pine/40">
              <Avatar name={c.contact.name} phone={c.contact.phone} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{c.contact.name ?? c.contact.phone}</span>
                  <span className="flex-none text-[11px] text-ink-faint">{fmtRelative(c.lastMessageAt)}</span>
                </div>
                <div className="truncate text-xs text-ink-muted">{c.messages[0]?.content ?? "—"}</div>
                <div className="mt-1.5 flex gap-1.5">
                  <StatusChip status={c.contact.status} />
                  {c.status === "HUMANO" && <StatusChip status="HUMANO" />}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
