import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtTime } from "../api";
import { useAuth } from "../auth";
import { Avatar, Spinner, StatusChip, Empty } from "../components/ui";

type Data = {
  stats: { appointmentsToday: number; newLeads: number; awaitingHuman: number };
  todayAppointments: any[];
  awaitingConversations: any[];
};

function TrialBanner() {
  const { me } = useAuth();
  if (!me) return null;
  const { subscriptionStatus, subscriptionActive, trialEndsAt } = me.tenant;

  // Assinatura paga em dia: nada a mostrar
  if (subscriptionStatus === "ATIVA") return null;

  if (!subscriptionActive) {
    return (
      <Link to="/plano" className="card block border-brick bg-brick-tint/60 text-sm">
        <strong className="text-brick">Sua IA está pausada.</strong>{" "}
        <span className="text-ink-muted">
          O período de teste terminou e os leads não estão sendo respondidos. Assine para reativar →
        </span>
      </Link>
    );
  }

  if (subscriptionStatus === "TRIAL" && trialEndsAt) {
    const daysLeft = Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000));
    if (daysLeft > 5) return null; // só chama atenção na reta final
    return (
      <Link to="/plano" className="card block border-marigold bg-marigold-tint/60 text-sm">
        <strong className="text-marigold">
          {daysLeft === 0 ? "Último dia de teste." : `Faltam ${daysLeft} dia${daysLeft === 1 ? "" : "s"} de teste.`}
        </strong>{" "}
        <span className="text-ink-muted">Assine para a IA continuar atendendo →</span>
      </Link>
    );
  }
  return null;
}

export default function Dashboard() {
  const { me } = useAuth();
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    void api<Data>("/dashboard").then(setData).catch(() => setData(null));
  }, []);

  const firstName = me?.user.name.split(" ")[0] ?? "";
  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  if (!data) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold">Bom dia, {firstName} 👋</h1>
        <p className="mt-0.5 text-sm capitalize text-ink-muted">{today}</p>
      </div>

      <TrialBanner />

      {!me?.tenant.whatsappConnected && (
        <Link to="/minha-ia" className="card block border-marigold bg-marigold-tint/60 text-sm">
          <strong className="text-marigold">WhatsApp ainda não conectado.</strong>{" "}
          <span className="text-ink-muted">Configure em Minha IA para a atendente começar a trabalhar →</span>
        </Link>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { n: data.stats.appointmentsToday, label: "Consultas hoje" },
          { n: data.stats.newLeads, label: "Leads novos" },
          { n: data.stats.awaitingHuman, label: "Aguardam você" },
        ].map((s) => (
          <div key={s.label} className="card">
            <div className="font-display text-2xl font-bold text-pine-strong">{s.n}</div>
            <div className="mt-1 text-xs text-ink-muted">{s.label}</div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="label">Agenda de hoje</h2>
        {data.todayAppointments.length === 0 ? (
          <Empty>Nenhuma consulta hoje.</Empty>
        ) : (
          <div className="space-y-2">
            {data.todayAppointments.map((a) => (
              <div key={a.id} className="card flex items-center gap-3 py-3">
                <div className="w-12 flex-none font-display text-sm font-bold text-ink-muted">
                  {fmtTime(a.startsAt)}
                </div>
                <div className="min-w-0 flex-1 border-l-2 border-pine pl-3">
                  <div className="truncate text-sm font-semibold">{a.contact.name ?? a.contact.phone}</div>
                  <div className="truncate text-xs text-ink-muted">
                    {a.service.name}
                    {a.professional ? ` · ${a.professional.name}` : ""}
                  </div>
                </div>
                <StatusChip status={a.status} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="label">Precisam de você</h2>
        {data.awaitingConversations.length === 0 ? (
          <Empty>Nenhuma conversa aguardando — a IA está dando conta. 🎉</Empty>
        ) : (
          <div className="space-y-2">
            {data.awaitingConversations.map((c) => (
              <Link key={c.id} to={`/conversas/${c.id}`} className="card flex items-center gap-3 py-3">
                <Avatar name={c.contact.name} phone={c.contact.phone} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{c.contact.name ?? c.contact.phone}</div>
                  <div className="truncate text-xs text-ink-muted">{c.messages[0]?.content}</div>
                </div>
                <StatusChip status="HUMANO" />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
