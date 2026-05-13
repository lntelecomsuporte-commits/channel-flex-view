import { useEffect, useRef, useState } from "react";
import { isSelectKey } from "@/lib/remoteKeys";

interface Props {
  onClose: () => void;
}

type TestState = "idle" | "running" | "ok" | "warn" | "fail";

interface Result {
  label: string;
  state: TestState;
  detail: string;
}

const PROXY_BASE = "/hls-proxy";
const LOGO_TEST = "/logos/_diag.bin"; // se não existir cai em 404, ainda mede latência
const SAMPLE_BYTES_FALLBACK = "/icons/icon-512.png";

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; ok: boolean; value?: T; error?: any }> {
  const t0 = performance.now();
  try {
    const value = await fn();
    return { ms: performance.now() - t0, ok: true, value };
  } catch (error) {
    return { ms: performance.now() - t0, ok: false, error };
  }
}

export default function NetworkDiagnostics({ onClose }: Props) {
  const [results, setResults] = useState<Result[]>([
    { label: "Latência ao servidor", state: "idle", detail: "" },
    { label: "Estabilidade (jitter)", state: "idle", detail: "" },
    { label: "Throughput de download", state: "idle", detail: "" },
    { label: "Proxy HLS acessível", state: "idle", detail: "" },
    { label: "Conexão (navigator)", state: "idle", detail: "" },
  ]);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    document.body.dataset.modalOpen = "true";
    return () => { delete document.body.dataset.modalOpen; };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (isSelectKey(e) && !running) {
        e.preventDefault();
        runTests();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [running, onClose]);

  const update = (i: number, patch: Partial<Result>) =>
    setResults((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const runTests = async () => {
    if (running) return;
    setRunning(true);
    cancelRef.current = false;

    // 1) Latência: 5 HEADs no manifest.json
    update(0, { state: "running", detail: "medindo..." });
    const samples: number[] = [];
    for (let i = 0; i < 5 && !cancelRef.current; i++) {
      const r = await timed(() => fetch(`/manifest.json?ping=${Date.now()}`, { cache: "no-store", method: "HEAD" }));
      if (r.ok) samples.push(r.ms);
      await new Promise((res) => setTimeout(res, 120));
    }
    if (samples.length === 0) {
      update(0, { state: "fail", detail: "sem resposta" });
    } else {
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      const state: TestState = avg < 80 ? "ok" : avg < 200 ? "warn" : "fail";
      update(0, { state, detail: `${avg.toFixed(0)} ms (média de ${samples.length})` });

      // 2) Jitter
      const max = Math.max(...samples);
      const min = Math.min(...samples);
      const jitter = max - min;
      const jState: TestState = jitter < 60 ? "ok" : jitter < 200 ? "warn" : "fail";
      update(1, { state: jState, detail: `±${jitter.toFixed(0)} ms (min ${min.toFixed(0)} / max ${max.toFixed(0)})` });
    }

    // 3) Throughput
    update(2, { state: "running", detail: "baixando..." });
    const t0 = performance.now();
    let bytes = 0;
    try {
      const r = await fetch(`${SAMPLE_BYTES_FALLBACK}?dl=${Date.now()}`, { cache: "no-store" });
      const blob = await r.blob();
      bytes = blob.size;
    } catch {
      bytes = 0;
    }
    const elapsed = (performance.now() - t0) / 1000;
    if (bytes === 0) {
      update(2, { state: "fail", detail: "falhou" });
    } else {
      const mbps = (bytes * 8) / elapsed / 1_000_000;
      const tState: TestState = mbps > 5 ? "ok" : mbps > 2 ? "warn" : "fail";
      update(2, { state: tState, detail: `${mbps.toFixed(2)} Mbps (${(bytes / 1024).toFixed(0)} KB em ${elapsed.toFixed(2)}s)` });
    }

    // 4) Proxy HLS reachable
    update(3, { state: "running", detail: "verificando..." });
    const proxy = await timed(() => fetch(`${PROXY_BASE}?ch=__diag__`, { cache: "no-store" }));
    // 400/401/403 também mostram que o proxy ESTÁ no ar
    if (proxy.ok || (proxy.value as Response | undefined)?.status) {
      const status = (proxy.value as Response | undefined)?.status ?? 0;
      const reachable = status > 0;
      update(3, {
        state: reachable ? "ok" : "fail",
        detail: reachable ? `HTTP ${status} em ${proxy.ms.toFixed(0)} ms` : "sem resposta",
      });
    } else {
      update(3, { state: "fail", detail: "sem resposta" });
    }

    // 5) navigator.connection
    const conn = (navigator as any).connection;
    if (conn) {
      update(4, {
        state: "ok",
        detail: `${conn.effectiveType || "?"} • ~${conn.downlink ?? "?"} Mbps • RTT ~${conn.rtt ?? "?"} ms`,
      });
    } else {
      update(4, { state: "warn", detail: "API não disponível" });
    }

    setRunning(false);
  };

  // Auto-roda ao abrir
  useEffect(() => {
    runTests();
    return () => { cancelRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stateColor = (s: TestState) =>
    s === "ok" ? "text-green-500"
    : s === "warn" ? "text-yellow-500"
    : s === "fail" ? "text-destructive"
    : s === "running" ? "text-primary animate-pulse"
    : "text-muted-foreground";

  const stateIcon = (s: TestState) =>
    s === "ok" ? "✓" : s === "warn" ? "!" : s === "fail" ? "✕" : s === "running" ? "…" : "•";

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-background/95 animate-fade-in"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-6 w-[min(92vw,560px)] max-h-[90vh] overflow-y-auto bg-card border border-border rounded-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-foreground">📶 Diagnóstico de rede</h2>
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Fechar ✕
          </button>
        </div>

        <div className="space-y-2">
          {results.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-secondary">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{r.label}</p>
                <p className="text-xs text-muted-foreground truncate">{r.detail || "—"}</p>
              </div>
              <div className={`text-2xl font-bold ${stateColor(r.state)}`}>{stateIcon(r.state)}</div>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center mt-5">
          <p className="text-xs text-muted-foreground">
            OK refaz os testes • Voltar fecha
          </p>
          <button
            onClick={runTests}
            disabled={running}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50 text-sm"
          >
            {running ? "Testando..." : "Testar novamente"}
          </button>
        </div>
      </div>
    </div>
  );
}
