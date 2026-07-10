import { useEffect, useState } from "react";
import { api, fmtTime, fmtPrice } from "../api";
import { Empty, PageHeader, Spinner, StatusChip } from "../components/ui";

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function Agenda() {
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [items, setItems] = useState<any[] | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = () => {
    setItems(null);
    void api<any[]>(`/appointments?date=${date}`).then(setItems).catch(() => setItems([]));
  };

  useEffect(load, [date]);

  const shiftDay = (delta: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(toISODate(d));
  };

  const setStatus = async (id: string, status: string) => {
    await api(`/appointments/${id}`, { method: "PATCH", body: { status } });
    load();
  };

  const dayLabel = new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  return (
    <div>
      <PageHeader
        title="Agenda"
        action={
          <button className="btn-primary w-auto px-4 py-2.5" onClick={() => setShowNew(true)}>
            + Agendar
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <button className="btn-ghost px-3 py-2" onClick={() => shiftDay(-1)}>←</button>
        <div className="flex-1 text-center">
          <input
            type="date"
            className="input w-auto text-center font-semibold"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <div className="mt-1 text-xs capitalize text-ink-muted">{dayLabel}</div>
        </div>
        <button className="btn-ghost px-3 py-2" onClick={() => shiftDay(1)}>→</button>
      </div>

      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty>Nenhum agendamento neste dia.</Empty>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <div key={a.id} className="card flex items-center gap-3 py-3">
              <div className="w-12 flex-none font-display text-sm font-bold text-ink-muted">
                {fmtTime(a.startsAt)}
              </div>
              <div
                className={`min-w-0 flex-1 border-l-2 pl-3 ${
                  a.status === "CANCELADO" ? "border-ink/20 opacity-50" : "border-pine"
                }`}
              >
                <div className="truncate text-sm font-semibold">{a.contact.name ?? a.contact.phone}</div>
                <div className="truncate text-xs text-ink-muted">
                  {a.service.name} · {a.service.durationMin} min
                  {a.professional ? ` · ${a.professional.name}` : ""}
                  {a.createdBy === "IA" ? " · agendado pela IA" : ""}
                </div>
              </div>
              <div className="flex flex-none flex-col items-end gap-1.5">
                <StatusChip status={a.status} />
                {["AGENDADO", "CONFIRMADO"].includes(a.status) && (
                  <select
                    className="rounded-lg border border-ink/10 bg-surface-2 px-2 py-1 text-[11px] font-semibold text-ink-muted"
                    value=""
                    onChange={(e) => e.target.value && void setStatus(a.id, e.target.value)}
                  >
                    <option value="">Ações…</option>
                    {a.status === "AGENDADO" && <option value="CONFIRMADO">Confirmar</option>}
                    <option value="CONCLUIDO">Compareceu</option>
                    <option value="FALTOU">Faltou</option>
                    <option value="CANCELADO">Cancelar</option>
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && <NewAppointment date={date} onClose={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

function NewAppointment({ date, onClose }: { date: string; onClose: () => void }) {
  const [services, setServices] = useState<any[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [day, setDay] = useState(date);
  const [slots, setSlots] = useState<any[] | null>(null);
  const [slot, setSlot] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<any[]>("/services").then((s) => {
      const active = s.filter((x) => x.active);
      setServices(active);
      if (active[0]) setServiceId(active[0].id);
    });
  }, []);

  useEffect(() => {
    if (!serviceId) return;
    setSlots(null);
    setSlot("");
    void api<any[]>(`/appointments/slots?date=${day}&serviceId=${serviceId}`)
      .then(setSlots)
      .catch(() => setSlots([]));
  }, [serviceId, day]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/appointments", {
        method: "POST",
        body: {
          serviceId,
          startsAt: slot,
          contactName: name || undefined,
          contactPhone: phone,
        },
      });
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Erro ao agendar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-surface p-6 md:rounded-3xl"
      >
        <h2 className="font-display text-lg font-bold">Novo agendamento</h2>

        <div>
          <label className="label">Cliente (nome)</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Opcional" />
        </div>
        <div>
          <label className="label">WhatsApp do cliente</label>
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="5511999998888"
            required
          />
        </div>
        <div>
          <label className="label">Serviço</label>
          <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {fmtPrice(s.priceCents)} · {s.durationMin} min
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Dia</label>
          <input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div>
          <label className="label">Horário</label>
          {!slots ? (
            <p className="text-sm text-ink-muted">Carregando horários…</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-ink-muted">Sem horários livres neste dia.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {slots.map((s) => (
                <button
                  type="button"
                  key={s.startsAt}
                  onClick={() => setSlot(s.startsAt)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                    slot === s.startsAt
                      ? "border-pine bg-pine text-white"
                      : "border-ink/10 bg-surface text-ink-muted"
                  }`}
                >
                  {fmtTime(s.startsAt)}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-sm font-semibold text-brick">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary flex-1" disabled={busy || !slot || !phone}>
            {busy ? "Agendando…" : "Confirmar"}
          </button>
        </div>
      </form>
    </div>
  );
}
