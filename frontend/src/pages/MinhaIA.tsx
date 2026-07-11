import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { PageHeader, Spinner } from "../components/ui";
import WhatsAppConnect from "../components/WhatsAppConnect";

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 flex-none rounded-full transition ${on ? "bg-pine" : "bg-ink/20"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          on ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export default function MinhaIA() {
  const [settings, setSettings] = useState<any | null>(null);
  const [knowledge, setKnowledge] = useState<any[]>([]);
  const [saved, setSaved] = useState(false);

  const load = () => {
    void api<any>("/settings").then(setSettings).catch(() => {});
    void api<any[]>("/knowledge").then(setKnowledge).catch(() => {});
  };
  useEffect(load, []);

  if (!settings) return <Spinner />;

  const patch = async (body: Record<string, unknown>) => {
    const updated = await api<any>("/settings", { method: "PATCH", body });
    setSettings(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Minha IA"
        subtitle="Como sua atendente virtual trabalha"
        action={
          <Link to="/playground" className="btn-ghost px-4 py-2.5">
            Testar minha IA
          </Link>
        }
      />

      {saved && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-pine px-4 py-2 text-xs font-bold text-white shadow-lg">
          Salvo ✓
        </div>
      )}

      {/* Conexão WhatsApp */}
      <section className="card space-y-3">
        <h2 className="text-sm font-bold">Conexão com o WhatsApp</h2>
        <WhatsAppConnect
          webhookUrl={settings.webhookUrl}
          uazapiToken={settings.uazapiToken ?? null}
          onChange={load}
        />
      </section>

      {/* Configurações da IA */}
      <section className="card divide-y divide-ink/10">
        <div className="flex items-center justify-between py-3 first:pt-0">
          <div>
            <div className="text-sm font-semibold">Atendimento automático</div>
            <div className="text-xs text-ink-muted">IA responde os leads no WhatsApp</div>
          </div>
          <Toggle on={settings.aiEnabled} onChange={(v) => void patch({ aiEnabled: v })} />
        </div>

        <div className="py-3">
          <div className="mb-2 text-sm font-semibold">Horário da IA</div>
          <div className="flex items-center gap-2">
            <input
              type="time"
              className="input w-auto"
              defaultValue={settings.aiScheduleStart}
              onBlur={(e) => void patch({ aiScheduleStart: e.target.value })}
            />
            <span className="text-sm text-ink-muted">às</span>
            <input
              type="time"
              className="input w-auto"
              defaultValue={settings.aiScheduleEnd}
              onBlur={(e) => void patch({ aiScheduleEnd: e.target.value })}
            />
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            Fora do horário a IA avisa que retorna e continua coletando as informações do lead.
          </p>
        </div>

        <div className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm font-semibold">Follow-up de lead sumido</div>
            <div className="text-xs text-ink-muted">
              Reengaja quem parou de responder após{" "}
              <input
                type="number"
                min={1}
                max={72}
                className="w-12 rounded border border-ink/10 bg-surface-2 px-1 py-0.5 text-center text-xs font-bold"
                defaultValue={settings.followUpHours}
                onBlur={(e) => void patch({ followUpHours: Number(e.target.value) || 4 })}
              />{" "}
              horas (máx. 2 tentativas)
            </div>
          </div>
          <Toggle on={settings.followUpEnabled} onChange={(v) => void patch({ followUpEnabled: v })} />
        </div>

        <div className="py-3">
          <div className="mb-2 text-sm font-semibold">Lembrete de consulta</div>
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="number"
              min={1}
              max={168}
              className="w-14 rounded border border-ink/10 bg-surface-2 px-1 py-1 text-center text-xs font-bold"
              defaultValue={settings.reminderHours1}
              onBlur={(e) => void patch({ reminderHours1: Number(e.target.value) || 24 })}
            />
            h antes e
            <input
              type="number"
              min={0}
              max={168}
              className="w-14 rounded border border-ink/10 bg-surface-2 px-1 py-1 text-center text-xs font-bold"
              defaultValue={settings.reminderHours2 ?? 0}
              onBlur={(e) => {
                const v = Number(e.target.value);
                void patch({ reminderHours2: v > 0 ? v : null });
              }}
            />
            h antes (0 = desligado)
          </div>
        </div>

        <div className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm font-semibold">Mensagem pós-consulta</div>
            <div className="text-xs text-ink-muted">
              Agradecimento 1h depois de marcar "Compareceu" (+ pedido de avaliação, se houver link)
            </div>
          </div>
          <Toggle on={settings.postVisitEnabled} onChange={(v) => void patch({ postVisitEnabled: v })} />
        </div>

        {settings.postVisitEnabled && (
          <div className="py-3">
            <div className="mb-2 text-sm font-semibold">Link de avaliação no Google</div>
            <input
              className="input"
              defaultValue={settings.googleReviewUrl ?? ""}
              onBlur={(e) => {
                const v = e.target.value.trim();
                void patch({ googleReviewUrl: v || null });
              }}
              placeholder="https://g.page/r/…/review"
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              No Perfil da Empresa no Google: "Pedir avaliações" → copie o link curto.
            </p>
          </div>
        )}

        <div className="py-3 last:pb-0">
          <div className="mb-2 text-sm font-semibold">Tom de voz</div>
          <input
            className="input"
            defaultValue={settings.aiTone}
            onBlur={(e) => void patch({ aiTone: e.target.value })}
            placeholder="ex: amigável e informal"
          />
        </div>
      </section>

      {/* Base de conhecimento */}
      <section>
        <h2 className="label">Base de conhecimento ({knowledge.length} respostas)</h2>
        <p className="mb-3 text-xs text-ink-muted">
          Dúvidas frequentes, políticas e diferenciais. A IA usa isso pra responder — o que não estiver aqui nem nos serviços, ela escala pra você.
        </p>
        <KnowledgeEditor items={knowledge} onChange={load} />
      </section>
    </div>
  );
}

function KnowledgeEditor({ items, onChange }: { items: any[]; onChange: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/knowledge", { method: "POST", body: { title, content } });
      setTitle("");
      setContent("");
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await api(`/knowledge/${id}`, { method: "DELETE" });
    onChange();
  };

  return (
    <div className="space-y-2">
      {items.map((k) => (
        <div key={k.id} className="card py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold">{k.title}</div>
              <div className="mt-0.5 whitespace-pre-wrap text-xs text-ink-muted">{k.content}</div>
            </div>
            <button className="chip flex-none border border-brick/30 text-brick" onClick={() => void remove(k.id)}>
              ✕
            </button>
          </div>
        </div>
      ))}
      <form onSubmit={add} className="card space-y-2">
        <input
          className="input"
          placeholder="Pergunta ou assunto (ex: Formas de pagamento)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <textarea
          className="input min-h-20"
          placeholder="Resposta que a IA deve dar…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
        />
        <button className="btn-primary" disabled={busy}>
          {busy ? "Adicionando…" : "Adicionar à base"}
        </button>
      </form>
    </div>
  );
}
