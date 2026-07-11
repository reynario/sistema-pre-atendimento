import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, setToken } from "../api";
import { useAuth } from "../auth";

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [info, setInfo] = useState<{ clinicName: string; label: string | null } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ clinicName: string; label: string | null }>(`/invites/${token}`)
      .then(setInfo)
      .catch(() => setInvalid(true));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ token: string }>(`/invites/${token}/accept`, {
        method: "POST",
        body: form,
      });
      setToken(res.token);
      await refresh();
      nav("/");
    } catch (err: any) {
      setError(err.message ?? "Erro ao criar acesso");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="font-display text-3xl font-black text-pine-strong">Alô</div>
          {info && (
            <p className="mt-2 text-sm text-ink-muted">
              Você foi convidado pra equipe da <strong>{info.clinicName}</strong>
            </p>
          )}
        </div>

        {invalid ? (
          <div className="card p-6 text-center text-sm text-ink-muted">
            Este convite é inválido ou já expirou. Peça um novo link pra quem te convidou.
          </div>
        ) : !info ? (
          <div className="card p-6 text-center text-sm text-ink-muted">Carregando…</div>
        ) : (
          <form onSubmit={submit} className="card space-y-4 p-6">
            <div>
              <label className="label">Seu nome</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
            </div>
            <div>
              <label className="label">E-mail</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <label className="label">Senha</label>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
            </div>
            {error && <p className="text-sm font-semibold text-brick">{error}</p>}
            <button className="btn-primary" disabled={busy}>
              {busy ? "Criando…" : "Criar meu acesso"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
