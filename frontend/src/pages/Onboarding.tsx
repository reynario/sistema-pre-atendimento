import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtPrice } from "../api";
import { useAuth } from "../auth";
import ScheduleEditor from "../components/ScheduleEditor";

const STEPS = ["Serviços", "Horários", "Conhecimento", "WhatsApp"] as const;

export default function Onboarding() {
  const nav = useNavigate();
  const { me } = useAuth();
  const [step, setStep] = useState(0);

  const finish = () => {
    localStorage.setItem("alo_onboarded", "1");
    nav("/playground");
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <div className="mb-2 text-center font-display text-2xl font-black text-pine-strong">Alô</div>
      <p className="mb-6 text-center text-sm text-ink-muted">
        Bem-vindo, {me?.user.name.split(" ")[0]}! Vamos deixar sua atendente pronta em 4 passos.
      </p>

      {/* Progresso */}
      <div className="mb-6 flex items-center gap-1.5">
        {STEPS.map((label, i) => (
          <div key={label} className="flex-1">
            <div className={`h-1.5 rounded-full ${i <= step ? "bg-pine" : "bg-ink/10"}`} />
            <div className={`mt-1 text-center text-[10px] font-semibold ${i === step ? "text-pine-strong" : "text-ink-faint"}`}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {step === 0 && <StepServices onNext={() => setStep(1)} />}
      {step === 1 && (
        <StepWrap
          title="Quando vocês atendem?"
          subtitle="A IA só oferece horários dentro desses períodos."
        >
          <ScheduleEditor onSaved={() => setStep(2)} />
          <SkipRow onSkip={() => setStep(2)} label="Manter seg–sex, 9h às 18h" />
        </StepWrap>
      )}
      {step === 2 && <StepKnowledge onNext={() => setStep(3)} />}
      {step === 3 && <StepWhatsApp onFinish={finish} />}
    </div>
  );
}

function StepWrap({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-lg font-bold">{title}</h1>
      <p className="mb-4 mt-1 text-sm text-ink-muted">{subtitle}</p>
      {children}
    </div>
  );
}

function SkipRow({ onSkip, label }: { onSkip: () => void; label: string }) {
  return (
    <button onClick={onSkip} className="mt-3 w-full text-center text-xs font-semibold text-ink-faint underline">
      {label}
    </button>
  );
}

function StepServices({ onNext }: { onNext: () => void }) {
  const [services, setServices] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(false);

  const load = () => void api<any[]>("/services").then((s) => setServices(s.filter((x) => x.active)));
  useEffect(load, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/services", {
        method: "POST",
        body: {
          name,
          durationMin: Number(duration),
          priceCents: Math.round(Number(String(price).replace(",", ".")) * 100),
        },
      });
      setName("");
      setPrice("");
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepWrap
      title="O que vocês oferecem?"
      subtitle="Cadastre pelo menos 1 serviço com preço e duração — é daqui que a IA responde 'quanto custa?' e calcula os horários."
    >
      {services.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {services.map((s) => (
            <div key={s.id} className="card flex items-center justify-between py-2.5 text-sm">
              <span className="font-semibold">{s.name}</span>
              <span className="text-ink-muted">
                {fmtPrice(s.priceCents)} · {s.durationMin} min
              </span>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="card space-y-3">
        <input className="input" placeholder="Nome do serviço (ex: Limpeza de pele)" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3">
          <input className="input" placeholder="Preço (R$)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
          <input className="input" type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} required />
        </div>
        <button className="btn-ghost w-full" disabled={busy}>
          {busy ? "Adicionando…" : "+ Adicionar serviço"}
        </button>
      </form>
      <button className="btn-primary mt-3" onClick={onNext} disabled={services.length === 0}>
        Continuar
      </button>
      {services.length === 0 && (
        <p className="mt-2 text-center text-xs text-ink-faint">Adicione ao menos 1 serviço pra continuar</p>
      )}
    </StepWrap>
  );
}

function StepKnowledge({ onNext }: { onNext: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => void api<any[]>("/knowledge").then(setItems);
  useEffect(load, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/knowledge", { method: "POST", body: { title, content } });
      setTitle("");
      setContent("");
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepWrap
      title="O que a IA precisa saber?"
      subtitle="Endereço, formas de pagamento, convênios, estacionamento… O que não estiver aqui, a IA passa pra você em vez de inventar."
    >
      {items.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {items.map((k) => (
            <div key={k.id} className="card py-2.5 text-sm">
              <span className="font-semibold">{k.title}</span>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="card space-y-3">
        <input className="input" placeholder="Assunto (ex: Formas de pagamento)" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <textarea className="input min-h-20" placeholder="Resposta que a IA deve dar…" value={content} onChange={(e) => setContent(e.target.value)} required />
        <button className="btn-ghost w-full" disabled={busy}>
          {busy ? "Adicionando…" : "+ Adicionar"}
        </button>
      </form>
      <button className="btn-primary mt-3" onClick={onNext}>
        Continuar
      </button>
      <SkipRow onSkip={onNext} label="Preencher depois" />
    </StepWrap>
  );
}

function StepWhatsApp({ onFinish }: { onFinish: () => void }) {
  const [settings, setSettings] = useState<any | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<any>("/settings").then((s) => {
      setSettings(s);
      setToken(s.uazapiToken ?? "");
    });
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      if (token.trim()) {
        await api("/settings", { method: "PATCH", body: { uazapiToken: token.trim() } });
      }
      onFinish();
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepWrap
      title="Conectar o WhatsApp"
      subtitle="Este passo pede o token da sua instância na UazAPI. Se preferir, dá pra fazer depois em Minha IA — o playground funciona sem isso."
    >
      <div className="card space-y-3">
        <div>
          <label className="label">Token da instância UazAPI</label>
          <input className="input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Cole o token aqui (opcional)" />
        </div>
        {settings && (
          <div>
            <label className="label">URL do webhook (configure na UazAPI)</label>
            <div className="flex items-center gap-2">
              <code className="block flex-1 overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 text-xs">
                {settings.webhookUrl}
              </code>
              <button
                type="button"
                className="chip flex-none border border-ink/10 text-ink-muted"
                onClick={() => void navigator.clipboard.writeText(settings.webhookUrl)}
              >
                Copiar
              </button>
            </div>
          </div>
        )}
      </div>
      <button className="btn-primary mt-3" onClick={() => void save()} disabled={busy}>
        {busy ? "Salvando…" : "Concluir e testar minha IA 🎉"}
      </button>
      <SkipRow onSkip={onFinish} label="Conectar depois" />
    </StepWrap>
  );
}
