import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken } from "../api";
import { useAuth } from "../auth";

type PlanOption = { id: string; name: string; price: string; desc: string; badge?: string };

const PLANS: PlanOption[] = [
  { id: "MENSAL", name: "Mensal", price: "R$ 189/mês", desc: "Sem fidelidade" },
  { id: "TRIMESTRAL", name: "Trimestral", price: "R$ 483/trim.", desc: "Equivale a R$ 161/mês", badge: "-15%" },
  { id: "ANUAL", name: "Anual", price: "R$ 1.589/ano", desc: "Equivale a R$ 132/mês", badge: "-30%" },
];

export default function Register() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [form, setForm] = useState({ clinicName: "", userName: "", email: "", password: "" });
  const [plan, setPlan] = useState<string>("TRIMESTRAL");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { token } = await api<{ token: string }>("/auth/register", {
        method: "POST",
        body: { ...form, planCycle: plan },
      });
      setToken(token);
      await refresh();
      nav("/minha-ia");
    } catch (err: any) {
      setError(err.message ?? "Erro ao cadastrar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="font-display text-3xl font-black text-pine-strong">Alô</div>
          <p className="mt-2 text-sm text-ink-muted">
            Crie sua conta — <strong>14 dias grátis</strong>, sem cartão
          </p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <div>
            <label className="label">Nome da clínica</label>
            <input className="input" value={form.clinicName} onChange={set("clinicName")} required minLength={2} />
          </div>
          <div>
            <label className="label">Seu nome</label>
            <input className="input" value={form.userName} onChange={set("userName")} required minLength={2} />
          </div>
          <div>
            <label className="label">E-mail</label>
            <input className="input" type="email" value={form.email} onChange={set("email")} required />
          </div>
          <div>
            <label className="label">Senha</label>
            <input className="input" type="password" value={form.password} onChange={set("password")} required minLength={6} />
          </div>

          <div>
            <label className="label">Plano (após o período de teste)</label>
            <div className="space-y-2">
              {PLANS.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setPlan(p.id)}
                  className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition ${
                    plan === p.id ? "border-pine bg-pine-tint" : "border-ink/10 bg-surface"
                  }`}
                >
                  <span>
                    <span className="block text-sm font-bold">{p.name}</span>
                    <span className="text-xs text-ink-muted">{p.desc}</span>
                  </span>
                  <span className="text-right">
                    <span className="block font-display text-sm font-bold">{p.price}</span>
                    {p.badge && (
                      <span className="chip bg-marigold-tint text-marigold">{p.badge}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm font-semibold text-brick">{error}</p>}
          <button className="btn-primary" disabled={busy}>
            {busy ? "Criando…" : "Começar teste grátis"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-ink-muted">
          Já tem conta?{" "}
          <Link to="/login" className="font-semibold text-pine">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
