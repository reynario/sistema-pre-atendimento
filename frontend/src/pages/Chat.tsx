import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtTime } from "../api";
import { Avatar, Spinner } from "../components/ui";

export default function Chat() {
  const { id } = useParams<{ id: string }>();
  const [conv, setConv] = useState<any | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const data = await api<any>(`/conversations/${id}`);
    setConv(data);
  };

  useEffect(() => {
    void load().catch(() => {});
    const t = setInterval(() => void load().catch(() => {}), 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv?.messages?.length]);

  if (!conv) return <Spinner />;

  const isAi = conv.status === "IA";

  const toggleMode = async () => {
    await api(`/conversations/${id}/${isAi ? "assume" : "release"}`, { method: "POST" });
    await load();
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await api(`/conversations/${id}/messages`, { method: "POST", body: { content: draft.trim() } });
      setDraft("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col md:h-[calc(100vh-4rem)]">
      {/* Topo */}
      <div className="mb-3 flex items-center gap-3 border-b border-ink/10 pb-3">
        <Link to="/conversas" className="text-ink-muted">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7}>
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <Avatar name={conv.contact.name} phone={conv.contact.phone} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{conv.contact.name ?? conv.contact.phone}</div>
          <div className={`text-xs ${isAi ? "text-pine" : "text-brick"}`}>
            ● {isAi ? "IA respondendo" : "Você está no comando"}
          </div>
        </div>
        <button
          onClick={toggleMode}
          className={`chip flex-none border px-3 py-2 ${
            isAi ? "border-pine text-pine" : "border-ink/15 text-ink-muted"
          }`}
        >
          {isAi ? "Assumir" : "Devolver pra IA"}
        </button>
      </div>

      {/* Mensagens */}
      <div className="flex-1 space-y-2 overflow-y-auto pb-3">
        {conv.messages.map((m: any) => {
          const isIn = m.direction === "IN";
          return (
            <div key={m.id} className={`flex flex-col ${isIn ? "items-start" : "items-end"}`}>
              {!isIn && (
                <span className="mb-0.5 text-[9px] font-bold uppercase tracking-wide text-marigold">
                  {m.sender === "IA" ? "IA" : m.sender === "SISTEMA" ? "Automático" : "Equipe"}
                </span>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  isIn
                    ? "rounded-bl-md bg-surface-2 text-ink"
                    : "rounded-br-md bg-pine text-white"
                }`}
              >
                {m.type === "audio" && <span className="mr-1 opacity-70">🎙</span>}
                {m.content}
                <div className={`mt-1 text-right text-[9px] ${isIn ? "text-ink-faint" : "text-white/70"}`}>
                  {fmtTime(m.createdAt)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={send} className="flex items-center gap-2 border-t border-ink/10 pt-3">
        <input
          className="input flex-1 rounded-full"
          placeholder={isAi ? "Escrever aqui assume a conversa…" : "Escreva uma mensagem…"}
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
