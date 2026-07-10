import { useEffect, useState } from "react";
import { api, fmtPrice } from "../api";
import { Empty, PageHeader, Spinner } from "../components/ui";

export default function Services() {
  const [services, setServices] = useState<any[] | null>(null);
  const [professionals, setProfessionals] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    void api<any[]>("/services").then(setServices).catch(() => setServices([]));
    void api<any[]>("/professionals").then(setProfessionals).catch(() => {});
  };
  useEffect(load, []);

  const remove = async (id: string) => {
    if (!confirm("Desativar este serviço? A IA vai parar de oferecê-lo.")) return;
    await api(`/services/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <PageHeader
        title="Serviços"
        subtitle="É daqui que a IA tira preços e durações"
        action={
          <button className="btn-primary w-auto px-4 py-2.5" onClick={() => { setEditing(null); setShowForm(true); }}>
            + Serviço
          </button>
        }
      />

      {!services ? (
        <Spinner />
      ) : services.filter((s) => s.active).length === 0 ? (
        <Empty>
          Cadastre seus serviços com preço e duração — sem isso a IA não consegue responder preços nem agendar.
        </Empty>
      ) : (
        <div className="space-y-2">
          {services
            .filter((s) => s.active)
            .map((s) => (
              <div key={s.id} className="card flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{s.name}</div>
                  <div className="text-xs text-ink-muted">
                    {s.durationMin} min
                    {s.professional ? ` · ${s.professional.name}` : ""}
                    {s.description ? ` · ${s.description}` : ""}
                  </div>
                </div>
                <div className="font-display text-sm font-bold text-pine-strong">{fmtPrice(s.priceCents)}</div>
                <div className="flex flex-none gap-1">
                  <button className="chip border border-ink/10 text-ink-muted" onClick={() => { setEditing(s); setShowForm(true); }}>
                    Editar
                  </button>
                  <button className="chip border border-brick/30 text-brick" onClick={() => void remove(s.id)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}

      <section className="mt-8">
        <PageHeader title="Profissionais" />
        <ProfessionalList items={professionals} onChange={load} />
      </section>

      {showForm && (
        <ServiceForm
          service={editing}
          professionals={professionals}
          onClose={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}

function ProfessionalList({ items, onChange }: { items: any[]; onChange: () => void }) {
  const [name, setName] = useState("");

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await api("/professionals", { method: "POST", body: { name: name.trim() } });
    setName("");
    onChange();
  };

  const remove = async (id: string) => {
    await api(`/professionals/${id}`, { method: "DELETE" });
    onChange();
  };

  return (
    <div className="space-y-2">
      {items.map((p) => (
        <div key={p.id} className="card flex items-center justify-between py-3">
          <span className="text-sm font-semibold">{p.name}</span>
          <button className="chip border border-brick/30 text-brick" onClick={() => void remove(p.id)}>
            ✕
          </button>
        </div>
      ))}
      <form onSubmit={add} className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Nome do profissional (ex: Dra. Paula)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn-ghost flex-none">Adicionar</button>
      </form>
    </div>
  );
}

function ServiceForm({ service, professionals, onClose }: { service: any | null; professionals: any[]; onClose: () => void }) {
  const [form, setForm] = useState({
    name: service?.name ?? "",
    description: service?.description ?? "",
    durationMin: service?.durationMin ?? 30,
    price: service ? (service.priceCents / 100).toFixed(2) : "",
    professionalId: service?.professionalId ?? "",
  });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = {
      name: form.name,
      description: form.description || undefined,
      durationMin: Number(form.durationMin),
      priceCents: Math.round(Number(String(form.price).replace(",", ".")) * 100),
      professionalId: form.professionalId || null,
    };
    try {
      if (service) await api(`/services/${service.id}`, { method: "PATCH", body });
      else await api("/services", { method: "POST", body });
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
        <h2 className="font-display text-lg font-bold">{service ? "Editar serviço" : "Novo serviço"}</h2>
        <div>
          <label className="label">Nome</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Preço (R$)</label>
            <input className="input" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
          </div>
          <div>
            <label className="label">Duração (min)</label>
            <input className="input" type="number" min={5} step={5} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} required />
          </div>
        </div>
        <div>
          <label className="label">Profissional</label>
          <select className="input" value={form.professionalId} onChange={(e) => setForm({ ...form, professionalId: e.target.value })}>
            <option value="">Qualquer / equipe</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Descrição curta (a IA usa pra explicar)</label>
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>Cancelar</button>
          <button className="btn-primary flex-1" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </div>
  );
}
