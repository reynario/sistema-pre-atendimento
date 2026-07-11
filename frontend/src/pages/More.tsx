import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { PageHeader } from "../components/ui";

const ITEMS = [
  { to: "/servicos", label: "Serviços e preços", desc: "O que a IA oferece e agenda" },
  { to: "/horarios", label: "Horários e bloqueios", desc: "Quando a IA pode agendar; folgas e feriados" },
  { to: "/relatorios", label: "Relatórios", desc: "Conversão, no-show e leads por período" },
  { to: "/minha-ia", label: "Minha IA", desc: "Conexão WhatsApp, follow-up, base de conhecimento", ownerOnly: true },
  { to: "/equipe", label: "Equipe", desc: "Convide a recepção pro painel", ownerOnly: true },
  { to: "/playground", label: "Testar minha IA", desc: "Converse com sua atendente antes de ativar" },
  { to: "/notificacoes", label: "Notificações", desc: "Avisos de agendamentos e escalações" },
  { to: "/plano", label: "Meu plano", desc: "Assinatura e ciclo de cobrança", ownerOnly: true },
];

export default function More() {
  const { me, logout } = useAuth();
  const isOwner = me?.user.role === "OWNER";

  return (
    <div>
      <PageHeader title={me?.tenant.name ?? "Mais"} subtitle={me?.user.email} />
      <div className="space-y-2">
        {ITEMS.filter((i) => isOwner || !i.ownerOnly).map((i) => (
          <Link key={i.to} to={i.to} className="card flex items-center justify-between py-3.5 transition hover:border-pine/40">
            <div>
              <div className="text-sm font-semibold">{i.label}</div>
              <div className="text-xs text-ink-muted">{i.desc}</div>
            </div>
            <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-ink-faint" fill="none" stroke="currentColor" strokeWidth={1.7}>
              <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        ))}
        <button onClick={logout} className="card w-full py-3.5 text-left text-sm font-semibold text-brick">
          Sair da conta
        </button>
      </div>
    </div>
  );
}
