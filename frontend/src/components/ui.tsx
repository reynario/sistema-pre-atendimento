import type { ReactNode } from "react";

const AVATAR_COLORS = ["#1F6E5C", "#D98A22", "#B14732", "#4C7A8C", "#8C6B4C", "#5C7A3F"];

export function Avatar({ name, phone }: { name?: string | null; phone?: string }) {
  const label = (name ?? phone ?? "?").trim();
  const initials = label
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  const color = AVATAR_COLORS[(label.charCodeAt(0) || 0) % AVATAR_COLORS.length];
  return (
    <div
      className="flex h-10 w-10 flex-none items-center justify-center rounded-full font-display text-xs font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {initials || "?"}
    </div>
  );
}

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  NOVO: { label: "Novo", cls: "bg-surface-2 text-ink-muted border border-ink/10" },
  CONVERSANDO: { label: "Conversando", cls: "bg-marigold-tint text-marigold" },
  AGENDADO: { label: "Agendado", cls: "bg-pine-tint text-pine-strong" },
  CONFIRMADO: { label: "Confirmado", cls: "bg-pine text-white" },
  COMPARECEU: { label: "Compareceu", cls: "bg-pine-tint text-pine-strong" },
  FALTOU: { label: "Faltou", cls: "bg-brick-tint text-brick" },
  PERDIDO: { label: "Perdido", cls: "bg-brick-tint text-brick" },
  CONCLUIDO: { label: "Concluído", cls: "bg-pine-tint text-pine-strong" },
  CANCELADO: { label: "Cancelado", cls: "bg-brick-tint text-brick" },
  IA: { label: "IA respondendo", cls: "bg-marigold-tint text-marigold" },
  HUMANO: { label: "Aguarda você", cls: "bg-brick-tint text-brick" },
};

export function StatusChip({ status }: { status: string }) {
  const meta = STATUS_CHIP[status] ?? { label: status, cls: "bg-surface-2 text-ink-muted" };
  return <span className={`chip ${meta.cls}`}>{meta.label}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-xl font-bold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="card py-10 text-center text-sm text-ink-muted">{children}</div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
    </div>
  );
}
