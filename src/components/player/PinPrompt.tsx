import { useEffect, useRef, useState } from "react";

interface PinPromptProps {
  title?: string;
  description?: string;
  expectedPin?: string; // se omitido, retorna o que o usuário digitou via onSubmit
  onSubmit: (pin: string) => boolean | void; // retornar false = PIN errado
  onCancel: () => void;
}

/**
 * Modal de PIN parental — 4 dígitos, navegável por controle (números, OK, Voltar).
 * Captura todos os eventos enquanto está aberto pra não vazar pro PlayerPage.
 */
export default function PinPrompt({ title = "PIN parental", description, expectedPin, onSubmit, onCancel }: PinPromptProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();

      if (e.key === "Escape" || e.key === "Backspace") {
        if (pin.length > 0) {
          setPin((p) => p.slice(0, -1));
          setError(false);
        } else {
          onCancel();
        }
        return;
      }

      if (/^[0-9]$/.test(e.key)) {
        setError(false);
        setPin((p) => {
          const next = (p + e.key).slice(0, 4);
          if (next.length === 4 && !submittedRef.current) {
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
            }, 120);
          }
          return next;
        });
        return;
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [pin, expectedPin, onSubmit, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 backdrop-blur-sm animate-fade-in"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="glass-panel p-8 w-[min(90vw,420px)] text-center">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">🔞 Conteúdo restrito</p>
        <h2 className="text-2xl font-bold text-foreground mb-2">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mb-4">{description}</p>}
        <div className="flex justify-center gap-3 my-6">
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
        <p className="text-xs text-muted-foreground">
          Digite os 4 dígitos no controle • <strong>Voltar</strong> para cancelar
        </p>
      </div>
    </div>
  );
}
