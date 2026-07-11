import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtRelative } from "../api";
import { Avatar, Empty, PageHeader, Spinner, StatusChip } from "../components/ui";

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
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // busca com debounce aplicado
  const [funnel, setFunnel] = useState<Record<string, number>>({});
  const [items, setItems] = useState<any[] | null>(null);
  const [editing, setEditing] = useState<any | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const loadFunnel = () =>
    void api<Record<string, number>>("/contacts/funnel").then(setFunnel).catch(() => {});

  const load = () => {
    setItems(null);
    // Com busca ativa, procura em todas as etapas; sem busca, filtra pela etapa
    const params = query
      ? `?search=${encodeURIComponent(query)}`
      : `?status=${stage}`;
    void api<any[]>(`/contacts${params}`).then(setItems).catch(() => setItems([]));
  };

  useEffect(loadFunnel, [stage, query]);
  useEffect(load, [stage, query]);

  const changeStatus = async (id: string, status: string) => {
    await api(`/contacts/${id}`, { method: "PATCH", body: { status } });
    load();
    loadFunnel();
  };

  return (
    <div>
      <PageHeader title="Leads" subtitle="Funil do pré-atendimento" />

      <div className="mb-3">
        <input
          className="input"
          placeholder="Buscar por nome ou telefone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!query && (
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
      )}

      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty>{query ? "Nenhum lead encontrado para essa busca." : "Nenhum lead nesta etapa."}</Empty>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <div key={c.id} className={`card flex items-center gap-3 py-3 ${c.optOut ? "opacity-60" : ""}`}>
              <button onClick={() => setEditing(c)} className="flex-none" title="Editar contato">
                <Avatar name={c.name} phone={c.phone} />
              </button>
              <button onClick={() => setEditing(c)} className="min-w-0 flex-1 text-left">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{c.name ?? c.phone}</span>
                  {c.conversation && (
                    <span className="flex-none text-[11px] text-ink-faint">
                      {fmtRelative(c.conversation.lastMessageAt)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  {c.phone}
                  {query && <StatusChip status={c.status} />}
                  {c.optOut && <span className="chip bg-surface-2 text-ink-faint">🔕 opt-out</span>}
                </div>
                {c.lostReason && <div className="mt-0.5 text-xs text-brick">{c.lostReason}</div>}
              </button>
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

      {editing && (
        <EditContact
          contact={editing}
          onClose={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function EditContact({ contact, onClose }: { contact: any; onClose: () => void }) {
  const [name, setName] = useState(contact.name ?? "");
  const [optOut, setOptOut] = useState(Boolean(contact.optOut));
  const [lostReason, setLostReason] = useState(contact.lostReason ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/contacts/${contact.id}`, {
        method: "PATCH",
        body: {
          ...(name.trim() ? { name: name.trim() } : {}),
          optOut,
          lostReason: lostReason.trim() || null,
        },
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-t-3xl bg-surface p-6 md:rounded-3xl"
      >
        <h2 className="font-display text-lg font-bold">Editar contato</h2>
        <div>
          <label className="label">Nome</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={contact.phone} />
        </div>
        <div>
          <label className="label">Motivo de perda (se aplicável)</label>
          <input
            className="input"
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder="ex: achou caro, fechou com outra clínica…"
          />
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-ink/10 bg-surface-2 p-3">
          <input type="checkbox" className="mt-0.5" checked={optOut} onChange={(e) => setOptOut(e.target.checked)} />
          <span className="text-sm">
            <span className="font-semibold">Não enviar mensagens automáticas</span>
            <span className="block text-xs text-ink-muted">
              A IA, os follow-ups e os lembretes param de falar com este contato (opt-out / LGPD).
            </span>
          </span>
        </label>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary flex-1" disabled={busy}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
