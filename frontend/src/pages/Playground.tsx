import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

type Msg = { role: "user" | "assistant"; content: string; notes?: string[] };

export default function Playground() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, busy]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    try {
      const result = await api<{
        reply: string | null;
        escalated: boolean;
        escalationReason: string | null;
        sandboxNotes: string[];
      }>("/playground", {
        method: "POST",
        body: { messages: next.map(({ role, content }) => ({ role, content })) },
      });

      const notes = [...result.sandboxNotes];
      if (result.escalated) notes.push(`A IA escalaria para humano: ${result.escalationReason ?? ""}`);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.reply ?? "(a IA não respondeu — escalou direto para humano)",
          notes,
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ Erro: ${err.message}`, notes: [] },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col md:h-[calc(100vh-4rem)]">
      <div className="mb-3 flex items-center gap-3 border-b border-ink/10 pb-3">
        <Link to="/minha-ia" className="text-ink-muted">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7}>
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <div>
          <div className="font-display text-base font-bold">Testar minha IA</div>
          <div className="text-xs text-marigold">Modo teste — nada é enviado ao WhatsApp de verdade</div>
        </div>
        {messages.length > 0 && (
          <button className="chip ml-auto border border-ink/10 text-ink-muted" onClick={() => setMessages([])}>
            Limpar
          </button>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto pb-3">
        {messages.length === 0 && (
          <div className="card mx-auto mt-8 max-w-sm text-center text-sm text-ink-muted">
            Converse como se você fosse um cliente. Pergunte preços, peça horários, tente agendar — e veja
            como sua IA se sai antes de ativá-la no número real.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === "user" ? "items-start" : "items-end"}`}>
            {m.role === "assistant" && (
              <span className="mb-0.5 text-[9px] font-bold uppercase tracking-wide text-marigold">IA</span>
            )}
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "rounded-bl-md bg-surface-2 text-ink"
                  : "rounded-br-md bg-pine text-white"
              }`}
            >
              {m.content}
            </div>
            {m.notes && m.notes.length > 0 && (
              <div className="mt-1 max-w-[80%] rounded-xl border border-marigold bg-marigold-tint px-3 py-2 text-xs text-marigold">
                {m.notes.map((n, j) => (
                  <div key={j}>⚑ {n}</div>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="text-right text-xs text-ink-faint">IA digitando…</div>}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="flex items-center gap-2 border-t border-ink/10 pt-3">
        <input
          className="input flex-1 rounded-full"
          placeholder="Pergunte como se fosse um cliente…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-pine text-white disabled:opacity-50"
          disabled={busy || !draft.trim()}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}
