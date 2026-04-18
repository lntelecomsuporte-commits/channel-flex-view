import { X } from "lucide-react";
import type { EPGProgram } from "@/hooks/useEPG";

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return null;
  const r = rating.trim().toUpperCase();
  let bg = "bg-green-600";
  if (r === "18" || r === "18 ANOS") bg = "bg-black";
  else if (r === "16" || r === "16 ANOS") bg = "bg-red-600";
  else if (r === "14" || r === "14 ANOS") bg = "bg-orange-500";
  else if (r === "12" || r === "12 ANOS") bg = "bg-yellow-500";
  else if (r === "10" || r === "10 ANOS") bg = "bg-blue-500";
  else if (r === "L" || r === "LIVRE") bg = "bg-green-600";
  return (
    <span className={`${bg} text-white text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 leading-none`}>
      {r.replace(" ANOS", "")}
    </span>
  );
}

interface SynopsisModalProps {
  program: EPGProgram;
  channelName?: string;
  onClose: () => void;
}

const SynopsisModal = ({ program, channelName, onClose }: SynopsisModalProps) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-fade-in" onClick={onClose}>
      <div className="bg-background rounded-lg p-6 max-w-lg w-full mx-4 shadow-xl border border-border" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-3 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <RatingBadge rating={program.rating} />
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-foreground truncate">{program.title}</h3>
              <p className="text-sm text-muted-foreground">
                {channelName ? `${channelName} • ` : ""}
                {formatTime(program.start_date)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-foreground/90 leading-relaxed">{program.desc || "Sinopse não disponível."}</p>
      </div>
    </div>
  );
};

export default SynopsisModal;
