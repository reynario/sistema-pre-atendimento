import { useEffect, useState } from "react";
import { api, fmtDateTime } from "../api";
import { Empty, PageHeader } from "../components/ui";
import ScheduleEditor from "../components/ScheduleEditor";

export default function Horarios() {
  return (
    <div className="space-y-8 pb-8">
      <div>
        <PageHeader
          title="Horários"
          subtitle="Os horários que a IA oferece aos leads no WhatsApp"
        />
        <ScheduleEditor />
      </div>
      <Blocks />
    </div>
  );
}

function Blocks() {
  const [blocks, setBlocks] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    void api<any[]>("/schedule-blocks").then(setBlocks).catch(() => {});
  };
  useEffect(load, []);

  const remove = async (id: string) => {
    await api(`/schedule-blocks/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <PageHeader
        title="Bloqueios"
        subtitle="Folgas, feriados e imprevistos — a IA não oferece horários nesses períodos"
        action={
          <button className="btn-primary w-auto px-4 py-2.5" onClick={() => setShowForm(true)}>
            + Bloqueio
          </button>
        }
      />
      {blocks.length === 0 ? (
        <Empty>Nenhum bloqueio futuro.</Empty>
      ) : (
        <div className="space-y-2">
          {blocks.map((b) => (
            <div key={b.id} className="card flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-semibold">
                  {fmtDateTime(b.startsAt)} → {fmtDateTime(b.endsAt)}
                </div>
                {b.reason && <div className="text-xs text-ink-muted">{b.reason}</div>}
              </div>
              <button className="chip border border-brick/30 text-brick" onClick={() => void remove(b.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {showForm && <BlockForm onClose={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function BlockForm({ onClose }: { onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("13:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/schedule-blocks", {
        method: "POST",
        body: {
          startsAt: new Date(`${date}T${allDay ? "00:00" : start}:00`).toISOString(),
          endsAt: new Date(`${date}T${allDay ? "23:59" : end}:00`).toISOString(),
          reason: reason || undefined,
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
        <h2 className="font-display text-lg font-bold">Novo bloqueio</h2>
        <div>
          <label className="label">Dia</label>
          <input type="date" className="input" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          Dia inteiro
        </label>
        {!allDay && (
          <div className="flex items-center gap-2">
            <input type="time" className="input w-auto" value={start} onChange={(e) => setStart(e.target.value)} />
            <span className="text-sm text-ink-muted">às</span>
            <input type="time" className="input w-auto" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        )}
        <div>
          <label className="label">Motivo (opcional)</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Feriado, folga, congresso…" />
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>Cancelar</button>
          <button className="btn-primary flex-1" disabled={busy}>{busy ? "Salvando…" : "Bloquear"}</button>
        </div>
      </form>
    </div>
  );
}
