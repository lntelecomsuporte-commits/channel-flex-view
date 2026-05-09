import { useEffect, useRef, useState } from "react";
import { isSelectKey } from "@/lib/remoteKeys";

interface PinPromptProps {
  title?: string;
  description?: string;
  expectedPin?: string;
  onSubmit: (pin: string) => boolean | void | Promise<unknown>;
  onCancel: () => void;
}

// Layout do numpad navegável por setas (mesmo padrão de URA)
// 1 2 3
// 4 5 6
// 7 8 9
// ⌫ 0 OK
type Cell = { label: string; action: "digit" | "back" | "ok"; value?: string };
const GRID: Cell[][] = [
  [
    { label: "1", action: "digit", value: "1" },
    { label: "2", action: "digit", value: "2" },
    { label: "3", action: "digit", value: "3" },
  ],
  [
    { label: "4", action: "digit", value: "4" },
    { label: "5", action: "digit", value: "5" },
    { label: "6", action: "digit", value: "6" },
  ],
  [
    { label: "7", action: "digit", value: "7" },
    { label: "8", action: "digit", value: "8" },
    { label: "9", action: "digit", value: "9" },
  ],
  [
    { label: "⌫", action: "back" },
    { label: "0", action: "digit", value: "0" },
    { label: "OK", action: "ok" },
  ],
];

export default function PinPrompt({
  title = "PIN parental",
  description,
  expectedPin,
  onSubmit,
  onCancel,
}: PinPromptProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 3, c: 1 }); // foco inicial no "0"
  const submittedRef = useRef(false);

  const tryConfirm = (next: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setTimeout(() => {
      submittedRef.current = false;
      if (expectedPin !== undefined) {
        if (next === expectedPin) {
          onSubmit(next);
        } else {
          setError(true);
          setPin("");
        }
      } else {
        onSubmit(next);
      }
    }, 80);
  };

  const pushDigit = (d: string) => {
    setError(false);
    setPin((p) => {
      const next = (p + d).slice(0, 4);
      if (next.length === 4) tryConfirm(next);
      return next;
    });
  };

  const popDigit = () => {
    setError(false);
    setPin((p) => p.slice(0, -1));
  };

  const activate = (cell: Cell) => {
    if (cell.action === "digit" && cell.value) pushDigit(cell.value);
    else if (cell.action === "back") popDigit();
    else if (cell.action === "ok") {
      if (pin.length === 4) tryConfirm(pin);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Bloqueia 100% do evento pra não vazar pra PlayerPage
      e.preventDefault();
      e.stopPropagation();
      (e as KeyboardEvent & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();

      const key = e.key;
      const code = e.keyCode || 0;

      // Voltar / sair
      if (key === "Escape" || key === "GoBack" || code === 4 || code === 27) {
        onCancel();
        return;
      }

      // Backspace apaga; se vazio, cancela
      if (key === "Backspace" || code === 8) {
        if (pin.length > 0) popDigit();
        else onCancel();
        return;
      }

      // Digitação direta (teclado USB / numpad / celular)
      if (/^[0-9]$/.test(key)) {
        pushDigit(key);
        return;
      }

      // Navegação por setas no grid
      if (key === "ArrowUp" || code === 19) {
        setFocus((f) => ({ r: (f.r + GRID.length - 1) % GRID.length, c: f.c }));
        return;
      }
      if (key === "ArrowDown" || code === 20) {
        setFocus((f) => ({ r: (f.r + 1) % GRID.length, c: f.c }));
        return;
      }
      if (key === "ArrowLeft" || code === 21) {
        setFocus((f) => ({ r: f.r, c: (f.c + GRID[0].length - 1) % GRID[0].length }));
        return;
      }
      if (key === "ArrowRight" || code === 22) {
        setFocus((f) => ({ r: f.r, c: (f.c + 1) % GRID[0].length }));
        return;
      }

      // OK / Enter / Center ativa célula focada
      if (isSelectKey(e)) {
        activate(GRID[focus.r][focus.c]);
        return;
      }
    };

    // capture + bubble pra garantir prioridade sobre PlayerPage
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [pin, focus, expectedPin, onSubmit, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 animate-fade-in"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-6 w-[min(92vw,420px)] text-center bg-card border border-border rounded-xl">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">🔞 Conteúdo restrito</p>
        <h2 className="text-2xl font-bold text-foreground mb-1">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mb-3">{description}</p>}

        <div className="flex justify-center gap-3 my-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-12 h-14 rounded-lg border-2 flex items-center justify-center text-2xl font-bold tabular-nums transition-colors ${
                error
                  ? "border-destructive text-destructive"
                  : pin.length > i
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {pin.length > i ? "•" : ""}
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-destructive mb-2">PIN incorreto, tente novamente</p>}

        <div className="grid grid-cols-3 gap-2 my-4 mx-auto max-w-[280px]">
          {GRID.map((row, r) =>
            row.map((cell, c) => {
              const focused = focus.r === r && focus.c === c;
              const isOk = cell.action === "ok";
              const isBack = cell.action === "back";
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  onClick={() => {
                    setFocus({ r, c });
                    activate(cell);
                  }}
                  className={`h-14 rounded-lg border-2 text-xl font-semibold transition-all ${
                    focused
                      ? "border-primary bg-primary text-primary-foreground scale-105 shadow-lg"
                      : "border-border bg-card text-foreground hover:bg-accent"
                  } ${isOk ? "text-base" : ""} ${isBack ? "text-base" : ""}`}
                >
                  {cell.label}
                </button>
              );
            })
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Use as <strong>setas</strong> + <strong>OK</strong> ou digite no teclado • <strong>Voltar</strong> cancela
        </p>
      </div>
    </div>
  );
}
