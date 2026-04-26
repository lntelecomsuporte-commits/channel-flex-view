import { useState, useEffect, useRef } from "react";
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
}: VirtualKeyboardProps) => {
  const [shift, setShift] = useState(false);
  const rows = shift ? ROWS_UPPER : ROWS_LOWER;

  const press = (k: string) => {
    onKeyPress(k);
    if (shift) setShift(false);
  };

  return (
    <div className="bg-muted/40 border border-border rounded-md p-2 space-y-1.5 select-none">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1 justify-center">
          {row.map((k) => (
            <Button
              key={k}
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1 min-w-0 h-9 px-0 font-medium"
              onClick={() => press(k)}
            >
              {k}
            </Button>
          ))}
          {i === 3 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 px-2"
              onClick={() => setShift((s) => !s)}
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
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2" onClick={() => press("@")}>@</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2" onClick={() => press(".")}>.</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2" onClick={() => press("_")}>_</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2" onClick={() => press("-")}>-</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2 text-xs" onClick={() => { ".com".split("").forEach(onKeyPress); }}>.com</Button>
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2" onClick={() => press(".")}>.</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2" onClick={() => press(",")}>,</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2" onClick={() => press("!")}>!</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2" onClick={() => press("?")}>?</Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-2" onClick={() => press("@")}>@</Button>
          </>
        )}
        <Button type="button" variant="secondary" size="sm" className="h-9 flex-1" onClick={() => press(" ")}>
          <Space className="h-4 w-4" />
        </Button>
        {onFieldUp && (
          <Button type="button" variant="secondary" size="sm" className="h-9 px-2" onClick={onFieldUp} aria-label="Campo anterior">
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
        {onFieldDown && (
          <Button type="button" variant="secondary" size="sm" className="h-9 px-2" onClick={onFieldDown} aria-label="Próximo campo">
            <ArrowDown className="h-4 w-4" />
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" className="h-9 px-3" onClick={onBackspace}>
          <Delete className="h-4 w-4" />
        </Button>
        <Button type="button" variant="default" size="sm" className="h-9 px-3" onClick={onEnter}>
          <CornerDownLeft className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
