import { useEffect, useRef, useState } from "react";
import { api } from "../api";

type Status = { configured: boolean; connected: boolean; qrcode?: string };

function qrSrc(qr: string): string {
  return qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`;
}

/**
 * Conexão do WhatsApp em 1 clique: botão → backend cria a instância na
 * UazAPI + configura o webhook → QR aparece aqui → polling até conectar.
 * Tem modo manual (colar token) como fallback.
 */
export default function WhatsAppConnect({
  webhookUrl,
  uazapiToken,
  onChange,
}: {
  webhookUrl: string;
  uazapiToken: string | null;
  onChange?: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async (): Promise<Status | null> => {
    try {
      const s = await api<Status>("/settings/whatsapp-status");
      setStatus(s);
      // A UazAPI renova o QR sozinha — o polling mantém a imagem atual
      if (s.qrcode) setQr(s.qrcode);
      return s;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    void fetchStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const s = await fetchStatus();
      if (s?.connected) {
        if (pollRef.current) clearInterval(pollRef.current);
        setPairing(false);
        setQr(null);
        onChange?.();
      }
    }, 3000);
  };

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ qrcode: string | null; webhookConfigured: boolean }>(
        "/settings/whatsapp-connect",
        { method: "POST" },
      );
      if (res.qrcode) setQr(res.qrcode);
      if (!res.webhookConfigured) {
        setError(
          "Instância criada, mas o webhook não pôde ser configurado automaticamente — configure na UazAPI com a URL abaixo.",
        );
      }
      setPairing(true);
      startPolling();
    } catch (err: any) {
      setError(err.message ?? "Erro ao conectar");
      if (err?.status === 400) setManual(true);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (
      !confirm(
        "Desconectar o WhatsApp? A IA para de atender na hora. Use isso para trocar de número.",
      )
    )
      return;
    await api("/settings/whatsapp-disconnect", { method: "POST" });
    setQr(null);
    setPairing(false);
    await fetchStatus();
    onChange?.();
  };

  if (!status) return <p className="text-sm text-ink-muted">Verificando conexão…</p>;

  if (status.connected) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-pine-strong">
          ● Conectado — a IA está atendendo seu número.
        </p>
        <button className="chip flex-none border border-brick/30 text-brick" onClick={() => void disconnect()}>
          Desconectar / trocar número
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {qr ? (
        <div className="text-center">
          <p className="mb-2 text-sm text-ink-muted">
            No celular da clínica: <strong>WhatsApp → Aparelhos conectados → Conectar aparelho</strong> e
            aponte a câmera pro código. Ele se renova sozinho.
          </p>
          <img
            src={qrSrc(qr)}
            alt="QR code para conectar o WhatsApp"
            className="mx-auto w-52 rounded-2xl border border-ink/10 bg-white p-2"
          />
          <p className="mt-2 text-xs text-ink-faint">Aguardando leitura… a página atualiza sozinha.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            Clique no botão, escaneie o QR code com o WhatsApp da clínica e pronto — instância e
            webhook são configurados automaticamente.
          </p>
          <button className="btn-primary" onClick={() => void connect()} disabled={busy}>
            {busy ? "Preparando…" : pairing ? "Gerar novo QR code" : "Conectar WhatsApp"}
          </button>
        </>
      )}

      {error && <p className="text-sm font-semibold text-brick">{error}</p>}

      {/* Modo manual (fallback) */}
      <button
        type="button"
        className="text-xs font-semibold text-ink-faint underline"
        onClick={() => setManual((m) => !m)}
      >
        {manual ? "Esconder configuração manual" : "Configurar manualmente (avançado)"}
      </button>
      {manual && (
        <div className="space-y-3 rounded-xl border border-ink/10 bg-surface-2 p-3">
          <div>
            <label className="label">Token da instância UazAPI</label>
            <input
              className="input"
              defaultValue={uazapiToken ?? ""}
              onBlur={async (e) => {
                const v = e.target.value.trim();
                if (v !== (uazapiToken ?? "")) {
                  await api("/settings", { method: "PATCH", body: { uazapiToken: v || null } });
                  await fetchStatus();
                  onChange?.();
                }
              }}
              placeholder="Cole o token aqui"
            />
          </div>
          <div>
            <label className="label">URL do webhook (cole na UazAPI, eventos de mensagens)</label>
            <div className="flex items-center gap-2">
              <code className="block flex-1 overflow-x-auto rounded-lg bg-surface px-3 py-2 text-xs">
                {webhookUrl}
              </code>
              <button
                type="button"
                className="chip flex-none border border-ink/10 text-ink-muted"
                onClick={() => void navigator.clipboard.writeText(webhookUrl)}
              >
                Copiar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
