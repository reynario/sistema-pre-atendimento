import { useEffect, useState } from "react";
import { api, fmtRelative } from "../api";
import { Empty, PageHeader, Spinner, StatusChip } from "../components/ui";

const fmtBRL = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const SUB_LABEL: Record<string, string> = {
  TRIAL: "Trial",
  ATIVA: "Ativa",
  INADIMPLENTE: "Inadimplente",
  CANCELADA: "Cancelada",
};

export default function Admin() {
  const [overview, setOverview] = useState<any | null>(null);
  const [tenants, setTenants] = useState<any[] | null>(null);
  const [coupons, setCoupons] = useState<any[]>([]);

  const load = () => {
    void api<any>("/admin/overview").then(setOverview).catch(() => {});
    void api<any[]>("/admin/tenants").then(setTenants).catch(() => setTenants([]));
    void api<any[]>("/admin/coupons").then(setCoupons).catch(() => {});
  };
  useEffect(load, []);

  if (!overview || !tenants) return <Spinner />;

  const pending = tenants.filter((t) => t.approvalStatus === "PENDENTE");
  const others = tenants.filter((t) => t.approvalStatus !== "PENDENTE");

  return (
    <div className="space-y-6 pb-8">
      <PageHeader title="Admin da plataforma" subtitle="Clientes, receita, consumo de IA e cupons" />

      {/* Visão geral */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Clientes" value={String(overview.tenants.total)} />
        <Stat label="Aguardando aprovação" value={String(overview.tenants.pendentes)} warn={overview.tenants.pendentes > 0} />
        <Stat label="Assinaturas ativas" value={String(overview.tenants.ativos)} />
        <Stat label="Em trial" value={String(overview.tenants.emTrial)} />
        <Stat label="MRR (ativos)" value={fmtBRL(overview.revenue.mrrCents)} hint="mensalidade equivalente" />
        <Stat label="Pipeline (trials)" value={fmtBRL(overview.revenue.pipelineCents)} hint="se todos os trials converterem" />
        <Stat
          label="Tokens de IA (30d)"
          value={fmtK(overview.aiUsage30d.inputTokens + overview.aiUsage30d.outputTokens)}
        />
        <Stat label="Inadimplentes" value={String(overview.tenants.inadimplentes)} warn={overview.tenants.inadimplentes > 0} />
      </div>

      {/* Aprovações pendentes */}
      {pending.length > 0 && (
        <section>
          <h2 className="label">Cadastros aguardando aprovação</h2>
          <div className="space-y-2">
            {pending.map((t) => (
              <div key={t.id} className="card flex flex-wrap items-center gap-3 border-marigold py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-ink-muted">
                    {t.owner?.name} · {t.owner?.email} · {fmtRelative(t.createdAt)}
                    {t.couponCode ? ` · cupom ${t.couponCode}` : ""}
                  </div>
                </div>
                <button
                  className="chip bg-pine text-white"
                  onClick={async () => {
                    await api(`/admin/tenants/${t.id}/approve`, { method: "POST" });
                    load();
                  }}
                >
                  Aprovar
                </button>
                <button
                  className="chip border border-brick/30 text-brick"
                  onClick={async () => {
                    if (!confirm(`Recusar o cadastro de ${t.name}?`)) return;
                    await api(`/admin/tenants/${t.id}/reject`, { method: "POST" });
                    load();
                  }}
                >
                  Recusar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Clientes */}
      <section>
        <h2 className="label">Clientes ({others.length})</h2>
        {others.length === 0 ? (
          <Empty>Nenhum cliente ainda.</Empty>
        ) : (
          <div className="space-y-2">
            {others.map((t) => {
              const tokens = t.aiTokens30d.input + t.aiTokens30d.output;
              return (
                <div key={t.id} className="card py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        {t.name}
                        {!t.whatsappConnected && (
                          <span className="chip bg-surface-2 text-ink-faint">sem WhatsApp</span>
                        )}
                      </div>
                      <div className="text-xs text-ink-muted">
                        {t.owner?.email} · plano {t.planCycle.toLowerCase()} ·{" "}
                        {t.contacts} leads · {t.appointments} agendamentos ·{" "}
                        {fmtK(tokens)} tokens (30d)
                        {t.couponCode ? ` · cupom ${t.couponCode}` : ""}
                      </div>
                    </div>
                    {t.approvalStatus === "RECUSADO" ? (
                      <StatusChip status="PERDIDO" />
                    ) : (
                      <select
                        className="rounded-lg border border-ink/10 bg-surface-2 px-2 py-1 text-[11px] font-semibold text-ink-muted"
                        value={t.subscriptionStatus}
                        onChange={async (e) => {
                          await api(`/admin/tenants/${t.id}`, {
                            method: "PATCH",
                            body: { subscriptionStatus: e.target.value },
                          });
                          load();
                        }}
                      >
                        {Object.entries(SUB_LABEL).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Cupons */}
      <section>
        <h2 className="label">Cupons</h2>
        <div className="space-y-2">
          {coupons.map((c) => (
            <div key={c.id} className={`card flex items-center gap-3 py-3 ${c.active ? "" : "opacity-50"}`}>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm font-bold">{c.code}</div>
                <div className="text-xs text-ink-muted">
                  {c.discountPercent > 0 ? `${c.discountPercent}% off · ` : ""}
                  {c.extraTrialDays > 0 ? `+${c.extraTrialDays} dias de trial · ` : ""}
                  usado {c.usedCount}
                  {c.maxUses ? `/${c.maxUses}` : "x"}
                  {c.description ? ` · ${c.description}` : ""}
                </div>
              </div>
              <button
                className={`chip flex-none ${c.active ? "border border-ink/15 text-ink-muted" : "bg-pine text-white"}`}
                onClick={async () => {
                  await api(`/admin/coupons/${c.id}`, { method: "PATCH", body: { active: !c.active } });
                  load();
                }}
              >
                {c.active ? "Desativar" : "Reativar"}
              </button>
            </div>
          ))}
        </div>
        <CouponForm onCreated={load} />
      </section>
    </div>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="card">
      <div className={`font-display text-xl font-bold ${warn ? "text-brick" : "text-pine-strong"}`}>{value}</div>
      <div className="mt-1 text-xs text-ink-muted">{label}</div>
      {hint && <div className="text-[10px] text-ink-faint">{hint}</div>}
    </div>
  );
}

function CouponForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ code: "", discountPercent: 0, extraTrialDays: 0, maxUses: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/admin/coupons", {
        method: "POST",
        body: {
          code: form.code,
          description: form.description || undefined,
          discountPercent: Number(form.discountPercent) || 0,
          extraTrialDays: Number(form.extraTrialDays) || 0,
          maxUses: form.maxUses ? Number(form.maxUses) : null,
        },
      });
      setForm({ code: "", discountPercent: 0, extraTrialDays: 0, maxUses: "", description: "" });
      onCreated();
    } catch (err: any) {
      setError(err.message ?? "Erro ao criar cupom");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Código</label>
          <input className="input uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required minLength={3} />
        </div>
        <div>
          <label className="label">Desconto (%)</label>
          <input className="input" type="number" min={0} max={100} value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label">Dias extras de trial</label>
          <input className="input" type="number" min={0} max={90} value={form.extraTrialDays} onChange={(e) => setForm({ ...form, extraTrialDays: Number(e.target.value) })} />
        </div>
        <div>
          <label className="label">Máx. de usos (vazio = ilimitado)</label>
          <input className="input" type="number" min={1} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="label">Descrição (interna)</label>
        <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="ex: parceria com influencer X" />
      </div>
      {error && <p className="text-sm font-semibold text-brick">{error}</p>}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Criando…" : "Criar cupom"}
      </button>
      <p className="text-xs text-ink-faint">
        O % de desconto fica registrado pra quando o billing (Asaas) entrar; os dias extras de trial
        já valem hoje, aplicados na aprovação do cadastro.
      </p>
    </form>
  );
}
