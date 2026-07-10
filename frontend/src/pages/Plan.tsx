import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/ui";

type PlanOption = { id: string; name: string; price: string; per: string; desc: string; badge?: string };

const PLANS: PlanOption[] = [
  { id: "MENSAL", name: "Mensal", price: "R$ 189", per: "/mês", desc: "Sem fidelidade, cancela quando quiser" },
  { id: "TRIMESTRAL", name: "Trimestral", price: "R$ 483", per: "/trimestre", desc: "Equivale a R$ 161/mês", badge: "-15%" },
  { id: "ANUAL", name: "Anual", price: "R$ 1.589", per: "/ano", desc: "Equivale a R$ 132/mês", badge: "-30%" },
];

export default function Plan() {
  const { me, refresh } = useAuth();
  const [selected, setSelected] = useState(me?.tenant.planCycle ?? "MENSAL");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const trialDaysLeft = me?.tenant.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(me.tenant.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  const save = async () => {
    setBusy(true);
    try {
      await api("/settings/plan", { method: "PATCH", body: { planCycle: selected } });
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Meu plano" />

      {me?.tenant.subscriptionStatus === "TRIAL" && (
        <div className="card mb-4 border-marigold bg-marigold-tint/60 text-sm">
          <strong className="text-marigold">Período de teste:</strong>{" "}
          <span className="text-ink-muted">
            {trialDaysLeft} dia{trialDaysLeft === 1 ? "" : "s"} restante{trialDaysLeft === 1 ? "" : "s"}. A
            cobrança começa depois do teste.
          </span>
        </div>
      )}

      <div className="space-y-3">
        {PLANS.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelected(p.id)}
            className={`w-full rounded-2xl border-2 p-4 text-left transition ${
              selected === p.id ? "border-pine bg-pine-tint" : "border-ink/10 bg-surface"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-sm font-bold">{p.name}</span>
              {p.badge && <span className="chip bg-marigold-tint text-marigold">{p.badge}</span>}
            </div>
            <div className="mt-1.5 font-display text-xl font-bold">
              {p.price}
              <span className="font-sans text-xs font-semibold text-ink-muted">{p.per}</span>
            </div>
            <div className="mt-0.5 text-xs text-ink-muted">{p.desc}</div>
          </button>
        ))}
      </div>

      <button className="btn-primary mt-4" onClick={() => void save()} disabled={busy}>
        {saved ? "Plano atualizado ✓" : busy ? "Salvando…" : `Continuar com ${PLANS.find((p) => p.id === selected)?.name}`}
      </button>
      <p className="mt-3 text-center text-xs text-ink-faint">
        Cobrança automática em breve — por enquanto a equipe entra em contato com o link de pagamento.
      </p>
    </div>
  );
}
