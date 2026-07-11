import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Avatar, Empty, PageHeader, Spinner } from "../components/ui";

type TeamData = {
  users: { id: string; name: string; email: string; role: string }[];
  invites: { id: string; label: string | null; expiresAt: string; url: string }[];
};

export default function Team() {
  const { me } = useAuth();
  const isOwner = me?.user.role === "OWNER";
  const [data, setData] = useState<TeamData | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = () => void api<TeamData>("/team").then(setData).catch(() => {});
  useEffect(load, []);

  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/team/invites", { method: "POST", body: { label: label || undefined } });
      setLabel("");
      load();
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string, id: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const revoke = async (id: string) => {
    await api(`/team/invites/${id}`, { method: "DELETE" });
    load();
  };

  const removeUser = async (id: string) => {
    if (!confirm("Remover este membro da equipe? Ele perde o acesso na hora.")) return;
    await api(`/team/${id}`, { method: "DELETE" });
    load();
  };

  if (!data) return <Spinner />;

  return (
    <div className="space-y-6 pb-8">
      <PageHeader title="Equipe" subtitle="Quem acessa o painel da clínica" />

      <div className="space-y-2">
        {data.users.map((u) => (
          <div key={u.id} className="card flex items-center gap-3 py-3">
            <Avatar name={u.name} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{u.name}</div>
              <div className="text-xs text-ink-muted">{u.email}</div>
            </div>
            <span className={`chip ${u.role === "OWNER" ? "bg-pine-tint text-pine-strong" : "bg-surface-2 text-ink-muted border border-ink/10"}`}>
              {u.role === "OWNER" ? "Dono" : "Recepção"}
            </span>
            {isOwner && u.role !== "OWNER" && (
              <button className="chip border border-brick/30 text-brick" onClick={() => void removeUser(u.id)}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <section>
          <h2 className="label">Convites pendentes</h2>
          {data.invites.length === 0 ? (
            <Empty>Nenhum convite ativo.</Empty>
          ) : (
            <div className="space-y-2">
              {data.invites.map((i) => (
                <div key={i.id} className="card flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{i.label ?? "Convite"}</div>
                    <div className="truncate text-xs text-ink-faint">{i.url}</div>
                  </div>
                  <button className="chip flex-none border border-ink/10 text-ink-muted" onClick={() => void copy(i.url, i.id)}>
                    {copied === i.id ? "Copiado ✓" : "Copiar link"}
                  </button>
                  <a
                    className="chip flex-none bg-pine text-white"
                    href={`https://wa.me/?text=${encodeURIComponent(`Oi! Crie seu acesso ao painel da clínica por este link: ${i.url}`)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    WhatsApp
                  </a>
                  <button className="chip flex-none border border-brick/30 text-brick" onClick={() => void revoke(i.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={createInvite} className="card mt-3 space-y-3">
            <div>
              <label className="label">Novo convite (validade de 7 dias)</label>
              <input
                className="input"
                placeholder="Pra quem é? (ex: Recepção — Maria)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <button className="btn-primary" disabled={busy}>
              {busy ? "Gerando…" : "Gerar link de convite"}
            </button>
            <p className="text-xs text-ink-faint">
              Quem entrar pelo link vira <strong>Recepção</strong>: opera conversas, agenda e leads,
              mas não mexe em plano, configurações da IA nem equipe.
            </p>
          </form>
        </section>
      )}
    </div>
  );
}
