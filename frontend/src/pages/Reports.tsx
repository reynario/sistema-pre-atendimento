import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Empty } from "../components/ui";

type Report = {
  days: number;
  stats: {
    newLeads: number;
    appointmentsCreated: number;
    conversionRate: number | null;
    noShowRate: number | null;
    aiMessages: number;
    escalations: number;
  };
  funnel: Record<string, number>;
  byDay: { date: string; leads: number; appointments: number }[];
  topServices: { name: string; count: number }[];
};

const FUNNEL_ORDER = [
  ["NOVO", "Novo"],
  ["CONVERSANDO", "Conversando"],
  ["AGENDADO", "Agendado"],
  ["CONFIRMADO", "Confirmado"],
  ["COMPARECEU", "Compareceu"],
  ["FALTOU", "Faltou"],
  ["PERDIDO", "Perdido"],
] as const;

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export default function Reports() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Report | null>(null);

  useEffect(() => {
    setData(null);
    void api<Report>(`/reports?days=${days}`).then(setData).catch(() => {});
  }, [days]);

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Relatórios"
        action={
          <div className="flex gap-1.5">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`chip px-3 py-2 ${
                  days === d ? "bg-ink text-surface" : "border border-ink/10 bg-surface text-ink-muted"
                }`}
              >
                {d} dias
              </button>
            ))}
          </div>
        }
      />

      {!data ? (
        <Spinner />
      ) : (
        <>
          {/* Indicadores do período */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Leads novos" value={String(data.stats.newLeads)} />
            <Stat label="Agendamentos criados" value={String(data.stats.appointmentsCreated)} />
            <Stat
              label="Conversão lead → agenda"
              value={pct(data.stats.conversionRate)}
              hint="dos leads novos do período"
            />
            <Stat
              label="Taxa de falta (no-show)"
              value={pct(data.stats.noShowRate)}
              hint="dos atendimentos com desfecho"
              warn={data.stats.noShowRate !== null && data.stats.noShowRate > 0.2}
            />
            <Stat label="Respostas da IA" value={String(data.stats.aiMessages)} />
            <Stat label="Escalações p/ humano" value={String(data.stats.escalations)} />
          </div>

          <DailyChart title="Leads novos por dia" data={data.byDay} field="leads" />
          <DailyChart title="Agendamentos criados por dia" data={data.byDay} field="appointments" />

          {/* Funil */}
          <section className="card">
            <h2 className="mb-3 text-sm font-bold">Funil (situação atual de todos os contatos)</h2>
            <HBarList
              rows={FUNNEL_ORDER.map(([key, label]) => ({ label, value: data.funnel[key] ?? 0 }))}
            />
          </section>

          {/* Serviços */}
          <section className="card">
            <h2 className="mb-3 text-sm font-bold">Serviços mais agendados no período</h2>
            {data.topServices.length === 0 ? (
              <Empty>Nenhum agendamento no período.</Empty>
            ) : (
              <HBarList rows={data.topServices.map((s) => ({ label: s.name, value: s.count }))} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="card">
      <div className={`font-display text-2xl font-bold ${warn ? "text-brick" : "text-pine-strong"}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-ink-muted">{label}</div>
      {hint && <div className="text-[10px] text-ink-faint">{hint}</div>}
    </div>
  );
}

/** Barras verticais de uma série diária (uma série por gráfico, tooltip nativo por barra). */
function DailyChart({
  title,
  data,
  field,
}: {
  title: string;
  data: Report["byDay"];
  field: "leads" | "appointments";
}) {
  const max = Math.max(1, ...data.map((d) => d[field]));
  const total = data.reduce((acc, d) => acc + d[field], 0);
  return (
    <section className="card">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-bold">{title}</h2>
        <span className="text-xs text-ink-muted">{total} no total</span>
      </div>
      {total === 0 ? (
        <p className="py-4 text-center text-sm text-ink-muted">Sem dados no período.</p>
      ) : (
        <div className="flex h-28 items-end gap-px" role="img" aria-label={title}>
          {data.map((d) => {
            const label = `${new Date(`${d.date}T12:00:00`).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
            })}: ${d[field]}`;
            return (
              <div
                key={d.date}
                title={label}
                className="group relative flex-1 rounded-t"
                style={{ height: "100%" }}
              >
                <div
                  className="absolute bottom-0 w-full rounded-t bg-pine transition-colors group-hover:bg-pine-strong"
                  style={{ height: `${Math.max((d[field] / max) * 100, d[field] > 0 ? 4 : 0)}%` }}
                />
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-1.5 flex justify-between text-[10px] text-ink-faint">
        <span>
          {new Date(`${data[0]?.date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
        </span>
        <span>hoje</span>
      </div>
    </section>
  );
}

/** Lista de barras horizontais com rótulo e valor em texto. */
function HBarList({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3" title={`${r.label}: ${r.value}`}>
          <span className="w-28 flex-none truncate text-xs font-semibold text-ink-muted">{r.label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-surface-2">
            <div
              className="h-full rounded bg-pine"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
          <span className="w-8 flex-none text-right text-xs font-bold tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
