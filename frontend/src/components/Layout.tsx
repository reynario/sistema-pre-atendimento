import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

const NAV = [
  { to: "/", label: "Início", icon: "M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-6h4v6" },
  { to: "/conversas", label: "Conversas", icon: "M4 5h16v11H8l-4 4z" },
  { to: "/agenda", label: "Agenda", icon: "M4 5h16v15H4zM4 10h16M8 3v4M16 3v4" },
  { to: "/leads", label: "Leads", icon: "M4 5h16l-6 8v6l-4 2v-8z" },
  { to: "/mais", label: "Mais", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function Layout() {
  const { me } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const { count } = await api<{ count: number }>("/notifications/unread-count");
        if (alive) setUnread(count);
      } catch {
        /* ignora */
      }
    };
    void poll();
    const t = setInterval(poll, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen w-56 flex-none flex-col gap-1 border-r border-ink/10 p-5 md:flex">
        <div className="mb-6 px-2 font-display text-2xl font-black text-pine-strong">Alô</div>
        {NAV.filter((n) => n.to !== "/mais").map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                isActive ? "bg-pine-tint text-pine-strong" : "text-ink-muted hover:bg-surface-2"
              }`
            }
          >
            <Icon d={n.icon} className="h-[18px] w-[18px]" />
            {n.label}
          </NavLink>
        ))}
        <div className="my-2 border-t border-ink/10" />
        {[
          { to: "/servicos", label: "Serviços" },
          { to: "/minha-ia", label: "Minha IA" },
          { to: "/notificacoes", label: `Notificações${unread ? ` (${unread})` : ""}` },
          { to: "/plano", label: "Plano" },
        ].map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              `rounded-xl px-3 py-2.5 text-sm font-semibold ${
                isActive ? "bg-pine-tint text-pine-strong" : "text-ink-muted hover:bg-surface-2"
              }`
            }
          >
            {n.label}
          </NavLink>
        ))}
        <div className="mt-auto px-3 text-xs text-ink-faint">{me?.tenant.name}</div>
      </aside>

      {/* Conteúdo */}
      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-8">
        <Outlet />
      </main>

      {/* Tab bar mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-ink/10 bg-surface/95 px-1 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={({ isActive }) =>
              `relative flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-semibold ${
                isActive ? "text-pine" : "text-ink-faint"
              }`
            }
          >
            <Icon d={n.icon} />
            {n.label}
            {n.to === "/mais" && unread > 0 && (
              <span className="absolute -top-0.5 right-1.5 h-2 w-2 rounded-full bg-brick" />
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
