import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Delete, ArrowBigUp, CornerDownLeft, Space, ArrowUp, ArrowDown } from "lucide-react";

interface VirtualKeyboardProps {
  onKeyPress: (key: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
  onFieldUp?: () => void;
  onFieldDown?: () => void;
  mode?: "email" | "text";
  autoFocus?: boolean;
}

const ROWS_LOWER = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

const ROWS_UPPER = ROWS_LOWER.map((row) => row.map((k) => k.toUpperCase()));

export const VirtualKeyboard = ({
  onKeyPress,
  onBackspace,
  onEnter,
  onFieldUp,
  onFieldDown,
  mode = "text",
  autoFocus = false,
}: VirtualKeyboardProps) => {
  const [shift, setShift] = useState(false);
  const rows = shift ? ROWS_UPPER : ROWS_LOWER;
  const firstKeyRef = useRef<HTMLButtonElement>(null);
  const shiftBtnRef = useRef<HTMLButtonElement>(null);
  const keyRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Quando Shift é alternado, queremos restaurar o foco no MESMO botão
  // (mesma posição linha/coluna) — ou no próprio Shift se foi ele que disparou.
  const refocusKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => firstKeyRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  // Restaura o foco após re-render causado pelo toggle do Shift
  useEffect(() => {
    if (refocusKeyRef.current === "__shift__") {
      shiftBtnRef.current?.focus();
    } else if (refocusKeyRef.current) {
      keyRefs.current.get(refocusKeyRef.current)?.focus();
    }
    refocusKeyRef.current = null;
  }, [shift]);

  const setKeyRef = useCallback((id: string) => (el: HTMLButtonElement | null) => {
    if (el) keyRefs.current.set(id, el);
    else keyRefs.current.delete(id);
  }, []);

  const press = (k: string, posId: string) => {
    onKeyPress(k);
    if (shift) {
      // Mantém o foco no mesmo botão após desativar o shift
      refocusKeyRef.current = posId;
      setShift(false);
    }
  };

  const toggleShift = () => {
    refocusKeyRef.current = "__shift__";
    setShift((s) => !s);
  };

  return (
    <div className="bg-muted/40 border border-border rounded-md p-2 space-y-1.5 select-none">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1 justify-center">
          {row.map((k, kIdx) => {
            const posId = `${i}:${kIdx}`;
            return (
              <Button
                key={posId}
                ref={(el) => {
                  setKeyRef(posId)(el);
                  if (i === 0 && kIdx === 0) {
                    (firstKeyRef as React.MutableRefObject<HTMLButtonElement | null>).current = el;
                  }
                }}
                type="button"
                variant="secondary"
                size="sm"
                className="flex-1 min-w-0 h-9 px-0 font-medium tv:h-12 tv:text-lg"
                onClick={() => press(k, posId)}
              >
                {k}
              </Button>
            );
          })}
          {i === 3 && (
            <Button
              ref={shiftBtnRef}
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 px-2 tv:h-12 tv:px-3"
              onClick={toggleShift}
              aria-pressed={shift}
            >
              <ArrowBigUp className={shift ? "h-4 w-4 text-primary" : "h-4 w-4"} />
            </Button>
          )}
        </div>
      ))}

      <div className="flex gap-1 justify-center">
        {mode === "email" ? (
          <>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2 tv:h-12 tv:px-3" onClick={() => press("@", "sym:@")}>@</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2 tv:h-12 tv:px-3" onClick={() => press(".", "sym:.")}>.</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2 tv:h-12 tv:px-3" onClick={() => press("_", "sym:_")}>_</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2 tv:h-12 tv:px-3" onClick={() => press("-", "sym:-")}>-</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2 text-xs tv:h-12 tv:text-sm" onClick={() => { ".com".split("").forEach(onKeyPress); }}>.com</Button>
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2 tv:h-12 tv:px-3" onClick={() => press(".", "sym:.")}>.</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2 tv:h-12 tv:px-3" onClick={() => press(",", "sym:,")}>,</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2 tv:h-12 tv:px-3" onClick={() => press("!", "sym:!")}>!</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2 tv:h-12 tv:px-3" onClick={() => press("?", "sym:?")}>?</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2 tv:h-12 tv:px-3" onClick={() => press("@", "sym:@")}>@</Button>
          </>
        )}
        <Button type="button" variant="secondary" size="sm" className="h-9 flex-1 tv:h-12" onClick={() => press(" ", "sym:space")}>
          <Space className="h-4 w-4" />
        </Button>
        {onFieldUp && (
          <Button type="button" variant="secondary" size="sm" className="h-9 px-2 tv:h-12 tv:px-3" onClick={onFieldUp} aria-label="Campo anterior">
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
        {onFieldDown && (
          <Button type="button" variant="secondary" size="sm" className="h-9 px-2 tv:h-12 tv:px-3" onClick={onFieldDown} aria-label="Próximo campo">
            <ArrowDown className="h-4 w-4" />
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" className="h-9 px-3 tv:h-12 tv:px-4" onClick={onBackspace}>
          <Delete className="h-4 w-4" />
        </Button>
        <Button type="button" variant="default" size="sm" className="h-9 px-3 tv:h-12 tv:px-4" onClick={onEnter}>
          <CornerDownLeft className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
