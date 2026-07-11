import { useEffect, useState } from "react";
import { api } from "../api";

type Rule = { weekday: number; startTime: string; endTime: string };

const WEEKDAYS = [
  { n: 1, label: "Segunda" },
  { n: 2, label: "Terça" },
  { n: 3, label: "Quarta" },
  { n: 4, label: "Quinta" },
  { n: 5, label: "Sexta" },
  { n: 6, label: "Sábado" },
  { n: 0, label: "Domingo" },
];

type DayState = { open: boolean; startTime: string; endTime: string };

/**
 * Editor semanal de horários de atendimento (uma janela por dia).
 * É a fonte que a IA consulta pra oferecer horários — salvar aqui muda
 * imediatamente o que ela oferece no WhatsApp.
 */
export default function ScheduleEditor({ onSaved }: { onSaved?: () => void }) {
  const [days, setDays] = useState<Record<number, DayState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api<Rule[]>("/availability-rules").then((rules) => {
      const state: Record<number, DayState> = {};
      for (const { n } of WEEKDAYS) {
        const rule = rules.find((r) => r.weekday === n);
        state[n] = rule
          ? { open: true, startTime: rule.startTime, endTime: rule.endTime }
          : { open: false, startTime: "09:00", endTime: "18:00" };
      }
      setDays(state);
    });
  }, []);

  if (!days) return <p className="py-4 text-sm text-ink-muted">Carregando horários…</p>;

  const set = (n: number, patch: Partial<DayState>) =>
    setDays((prev) => (prev ? { ...prev, [n]: { ...prev[n], ...patch } } : prev));

  const save = async () => {
    setBusy(true);
    try {
      const rules = WEEKDAYS.filter(({ n }) => days[n].open).map(({ n }) => ({
        weekday: n,
        startTime: days[n].startTime,
        endTime: days[n].endTime,
      }));
      await api("/availability-rules", { method: "PUT", body: { rules } });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onSaved?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {WEEKDAYS.map(({ n, label }) => {
        const d = days[n];
        return (
          <div key={n} className="card flex items-center gap-3 py-2.5">
            <button
              type="button"
              onClick={() => set(n, { open: !d.open })}
              className={`relative h-6 w-11 flex-none rounded-full transition ${d.open ? "bg-pine" : "bg-ink/20"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  d.open ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
            <span className={`w-20 flex-none text-sm font-semibold ${d.open ? "" : "text-ink-faint"}`}>
              {label}
            </span>
            {d.open ? (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  className="input w-auto px-2 py-1.5 text-xs"
                  value={d.startTime}
                  onChange={(e) => set(n, { startTime: e.target.value })}
                />
                <span className="text-xs text-ink-muted">às</span>
                <input
                  type="time"
                  className="input w-auto px-2 py-1.5 text-xs"
                  value={d.endTime}
                  onChange={(e) => set(n, { endTime: e.target.value })}
                />
              </div>
            ) : (
              <span className="text-xs text-ink-faint">Fechado</span>
            )}
          </div>
        );
      })}
      <button className="btn-primary" onClick={() => void save()} disabled={busy}>
        {saved ? "Horários salvos ✓" : busy ? "Salvando…" : "Salvar horários"}
      </button>
    </div>
  );
}
